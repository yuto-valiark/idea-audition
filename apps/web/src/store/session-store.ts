import { create } from 'zustand';
import {
  REJECT_REASON_LABEL,
  type CommandPayload,
  type CommandType,
  type EphemeralMessage,
  type EventMessage,
  type SessionSnapshot,
} from '@idea-audition/protocol';
import { HipClient, type CommandOutcome, type ConnectionState, type SendOptions } from '../net/hip-client.ts';
import { useDisplay } from './display-store.ts';
import { anchorCenter } from '../shared/anchors.ts';

/** 業務状態：サーバーから届いた snapshot をそのまま持つ（判定はしない） */
interface SessionState {
  sessionId: string;
  judgeId: string | null;
  snapshot: SessionSnapshot | null;
  connection: ConnectionState;
  client: HipClient | null;
  /** 合言葉が必要・違うとき（公開環境） */
  accessDenied: 'required' | 'invalid' | null;
  connect(sessionId: string): void;
  submitAccessCode(code: string): void;
  send<T extends CommandType>(type: T, payload: CommandPayload<T>, opts?: SendOptions): Promise<CommandOutcome>;
}

const storageKey = (sessionId: string) => `idea-audition:judge:${sessionId}`;
const ACCESS_KEY = 'idea-audition:access-code';

/** 合言葉はこの端末に覚えておく（毎回入れなくてよいように）。読めない環境では毎回聞く */
export function readAccessCode() {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeAccessCode(code: string | null) {
  try {
    if (code) localStorage.setItem(ACCESS_KEY, code);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* 保存できなくても続行 */
  }
}
let sessionAccessCode: string | undefined;

function readJudgeId(sessionId: string) {
  try {
    return sessionStorage.getItem(storageKey(sessionId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeJudgeId(sessionId: string, judgeId: string) {
  try {
    sessionStorage.setItem(storageKey(sessionId), judgeId);
  } catch {
    /* プライベートモード等では保存しない */
  }
}

export const useSession = create<SessionState>((set, get) => ({
  sessionId: 'demo',
  judgeId: null,
  snapshot: null,
  connection: 'connecting',
  client: null,
  accessDenied: null,

  connect(sessionId) {
    get().client?.close();
    const client = new HipClient(
      sessionId,
      {
        onAccessDenied: (reason) => {
          if (reason === 'invalid') writeAccessCode(null);
          set({ accessDenied: reason });
        },
        onWelcome: (m) => {
          if (m.judgeId) writeJudgeId(sessionId, m.judgeId);
          set({ judgeId: m.judgeId, snapshot: m.snapshot, accessDenied: null });
        },
        onEvent: (m) => handleEvent(m, (snapshot) => set({ snapshot })),
        onEphemeral: handleEphemeral,
        onState: (connection) => set({ connection }),
        onProtocolError: (m) => {
          if (m.code === 'UNSUPPORTED_VERSION') {
            useDisplay.getState().toast('サーバーが新しくなりました。画面を再読み込みしてください', 'warn');
          }
        },
      },
      readJudgeId(sessionId),
      sessionAccessCode ?? readAccessCode(),
    );
    set({ sessionId, client });
    client.connect();
  },

  submitAccessCode(code) {
    sessionAccessCode = code.trim();
    writeAccessCode(sessionAccessCode);
    set({ accessDenied: null, connection: 'connecting' });
    get().connect(get().sessionId);
  },

  async send(type, payload, opts) {
    const client = get().client;
    if (!client) return { ok: false, reason: 'TIMEOUT' };
    const outcome = await client.send(type, payload, opts);
    if (!outcome.ok) {
      const label =
        outcome.reason === 'TIMEOUT' ? '通信が不安定です。もう一度お試しください' : REJECT_REASON_LABEL[outcome.reason];
      useDisplay.getState().toast(label, 'warn');
    }
    return outcome;
  },
}));

/* ----------------------- イベント → 演出のつなぎ ----------------------- */

function nameOf(snapshot: SessionSnapshot, instanceId: unknown) {
  return typeof instanceId === 'string' ? (snapshot.characters[instanceId]?.name ?? 'AI') : 'AI';
}

function handleEvent(e: EventMessage, apply: (s: SessionSnapshot) => void) {
  const display = useDisplay.getState();
  const myJudgeId = useSession.getState().judgeId;
  const d = e.detail;

  // DOM が新しい snapshot で描き変わる前に、移動元の位置を取っておく
  if (e.type === 'PROMOTION_CONFIRMED' && typeof d.instanceId === 'string') {
    const instanceId = d.instanceId;
    const character = e.snapshot.characters[instanceId];
    const drag = display.drag;
    const from =
      drag?.instanceId === instanceId ? drag.pointer : anchorCenter(`lower:${instanceId}`);
    if (drag?.instanceId === instanceId) display.setDrag(null);
    if (from && character) display.addFlight({ instanceId, designId: character.designId, from, kind: 'upper' });
  }

  // 退場した案は Idea BOX へ飛ばす（仕様書 22.7「落選：フリップを畳んで Idea BOX へ」）
  if (e.type === 'CANDIDATE_ARCHIVED' && typeof d.instanceId === 'string') {
    const from = anchorCenter(`lower:${d.instanceId}`);
    const character = e.snapshot.characters[d.instanceId];
    if (from && character) display.addFlight({ instanceId: d.instanceId, designId: character.designId, from, kind: 'box' });
  }

  apply(e.snapshot);

  if (e.type === 'CANDIDATE_ARCHIVED' && d.reason === 'rejected') {
    const by = typeof d.byJudgeId === 'string' ? e.snapshot.judges.find((j) => j.judgeId === d.byJudgeId)?.label : null;
    display.toast(`${nameOf(e.snapshot, d.instanceId)} の案を見送りました${by ? `（${by}）` : ''}。次の人と交代します`);
  }

  switch (e.type) {
    case 'PROMOTION_CONFIRMED':
      display.toast(`${nameOf(e.snapshot, d.instanceId)} が最終オーディションへ！`, 'gold');
      break;
    case 'FINALIST_CRITIQUE_POSTED':
      if (typeof d.fromInstanceId === 'string' && typeof d.toInstanceId === 'string') {
        display.setBubble(d.fromInstanceId, {
          text: String(d.text ?? ''),
          toInstanceId: d.toInstanceId,
          critiqueId: String(d.critiqueId ?? ''),
        });
      }
      break;
    case 'FINALIST_VERSION_PUBLISHED':
      if (typeof d.instanceId === 'string') {
        display.markUpdated(d.instanceId);
        const id = d.instanceId;
        setTimeout(() => useDisplay.getState().setBubble(id, null), 2500);
      }
      break;
    case 'CANDIDATE_ANSWERED':
      break;
    case 'CANDIDATE_REACTED':
      // 「うーん」に気づいたキャラが 🤔 で一言（ADR-0009 ③）
      if (typeof d.instanceId === 'string') {
        const id = d.instanceId;
        const key = `react:${e.seq}`;
        display.setBubble(id, { text: `🤔 ${String(d.text ?? '')}`, toInstanceId: '', critiqueId: key });
        setTimeout(() => {
          if (useDisplay.getState().bubbles[id]?.critiqueId === key) useDisplay.getState().setBubble(id, null);
        }, 6000);
      }
      break;
    case 'CANDIDATE_REVISED':
      if (typeof d.instanceId === 'string') {
        const id = d.instanceId;
        const key = `revised:${e.seq}`;
        display.setBubble(id, { text: '💡 別のかたちにしてみました！', toInstanceId: '', critiqueId: key });
        setTimeout(() => {
          if (useDisplay.getState().bubbles[id]?.critiqueId === key) useDisplay.getState().setBubble(id, null);
        }, 3500);
      }
      break;
    case 'JUDGE_UTTERANCE_RECEIVED':
      if (typeof d.judgeId === 'string' && typeof d.text === 'string') {
        display.addCaption({
          judgeId: d.judgeId,
          text: d.text,
          source: d.source === 'live' ? 'live' : 'text',
          intent: d.intent === 'instruction' || d.intent === 'question' || d.intent === 'reject' ? d.intent : 'comment',
          targetInstanceId: typeof d.targetInstanceId === 'string' ? d.targetInstanceId : null,
        });
        if (d.intent === 'question' && typeof d.targetInstanceId === 'string' && d.judgeId === myJudgeId) {
          display.select(d.targetInstanceId); // 回答が見えるよう詳細を開く
        }
      }
      break;
    case 'CONSENSUS_UPDATED': {
      const changes = Array.isArray(d.statusChanges) ? (d.statusChanges as { label: string; text: string; to: string }[]) : [];
      for (const c of changes) {
        if (c.to === 'agreed') display.toast(`合意：${c.label}「${c.text}」`, 'gold');
        else if (c.to === 'rejected') display.toast(`却下：${c.label}「${c.text}」`);
        else if (c.to === 'proposed' && !('from' in c && c.from)) display.toast(`新しい論点：${c.label}「${c.text}」`);
      }
      break;
    }
    case 'AI_MODE_CHANGED':
      display.toast(d.mode === 'gemini' ? 'AI を Gemini に切り替えました（クレジットを使います）' : 'AI を固定データに切り替えました（無料）');
      break;
    case 'CHAMPION_VOTE_STARTED':
      display.setMyVote(null);
      display.toast('最終投票が始まりました。推したい1案に投票してください', 'gold');
      break;
    case 'TIE_DETECTED':
      display.toast('同票です。ホストが優勝を決めます', 'gold');
      break;
    case 'HOST_CHANGED':
      if (d.judgeId === myJudgeId) display.toast('あなたがホストになりました');
      break;
    case 'SESSION_STARTED':
    case 'SESSION_RESET':
      display.clearBubbles();
      display.select(null);
      break;
  }
}

function handleEphemeral(m: EphemeralMessage) {
  if (!m.senderId) return;
  const display = useDisplay.getState();
  switch (m.type) {
    case 'CURSOR_MOVED':
      display.setCursor(m.senderId, m.payload ? { ...m.payload, updatedAt: Date.now() } : null);
      break;
    case 'DRAG_PREVIEW':
      display.setHeld(m.senderId, m.payload.instanceId);
      break;
    case 'MIC_STATE_CHANGED':
      display.setMic(m.senderId, m.payload.on);
      break;
  }
}

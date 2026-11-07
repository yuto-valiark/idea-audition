import { create } from 'zustand';
import {
  REJECT_REASON_LABEL,
  type CommandPayload,
  type CommandType,
  type EphemeralMessage,
  type EventMessage,
  type SessionSnapshot,
} from '@idea-audition/protocol';
import { HipClient, type CommandOutcome, type ConnectionState } from '../net/hip-client.ts';
import { useDisplay } from './display-store.ts';
import { anchorCenter } from '../shared/anchors.ts';

/** 業務状態：サーバーから届いた snapshot をそのまま持つ（判定はしない） */
interface SessionState {
  sessionId: string;
  judgeId: string | null;
  snapshot: SessionSnapshot | null;
  connection: ConnectionState;
  client: HipClient | null;
  connect(sessionId: string): void;
  send<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandOutcome>;
}

const storageKey = (sessionId: string) => `idea-audition:judge:${sessionId}`;

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

  connect(sessionId) {
    get().client?.close();
    const client = new HipClient(
      sessionId,
      {
        onWelcome: (m) => {
          if (m.judgeId) writeJudgeId(sessionId, m.judgeId);
          set({ judgeId: m.judgeId, snapshot: m.snapshot });
        },
        onEvent: (m) => handleEvent(m, (snapshot) => set({ snapshot })),
        onEphemeral: handleEphemeral,
        onState: (connection) => set({ connection }),
      },
      readJudgeId(sessionId),
    );
    set({ sessionId, client });
    client.connect();
  },

  async send(type, payload) {
    const client = get().client;
    if (!client) return { ok: false, reason: 'TIMEOUT' };
    const outcome = await client.send(type, payload);
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

  apply(e.snapshot);

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
    case 'JUDGE_UTTERANCE_RECEIVED':
      if (typeof d.judgeId === 'string' && typeof d.text === 'string') {
        display.addCaption({
          judgeId: d.judgeId,
          text: d.text,
          source: d.source === 'live' ? 'live' : 'text',
          intent: d.intent === 'instruction' || d.intent === 'question' ? d.intent : 'comment',
          targetInstanceId: typeof d.targetInstanceId === 'string' ? d.targetInstanceId : null,
        });
        if (d.intent === 'question' && typeof d.targetInstanceId === 'string' && d.judgeId === myJudgeId) {
          display.select(d.targetInstanceId); // 回答が見えるよう詳細を開く
        }
      }
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

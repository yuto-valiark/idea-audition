import { create } from 'zustand';
import { useDisplay } from '../../store/display-store.ts';
import { onEphemeral, useSession } from '../../store/session-store.ts';
import { CallClient, type CallSignal } from './call-client.ts';
import { useVoice } from '../voice/voice-store.ts';

interface CallStore {
  inCall: boolean;
  joining: boolean;
  /** マイクのミュート。既定はオフ（声が届く）。ミュート中は通話にも文字起こしにも声を送らない */
  muted: boolean;
  /** ブラウザが音を止めている（ページでまだクリックしていない）。クリックすれば鳴る */
  blocked: boolean;
  /** マイクが使えず、聞くだけで参加している */
  listenOnly: boolean;
  /** マイクの許可を取り直して、話せる状態でつなぎ直す */
  retryMic(): Promise<void>;
  unlock(): Promise<void>;
  /** 声がつながっている相手 */
  peers: string[];
  /** いま話している人（自分を含む） */
  speaking: Record<string, boolean>;
  /** 通話に入っている人（自分以外。CALL_STATE で知る） */
  inCallOthers: Record<string, boolean>;
  join(): Promise<void>;
  leave(): void;
  toggleMute(): void;
}

let client: CallClient | null = null;

/** 通話で使っているマイク（文字起こしで使い回す。2回目にマイクを開くと、iPhone などで通話の声が止まるため） */
export const callMicrophone = () => client?.microphone ?? null;

/** 観覧者の通話用の ID（このタブのあいだ同じ） */
const spectatorCallId = `spec_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('')}`;
const callId = () => useSession.getState().judgeId ?? spectatorCallId;
let syncing = false;

/**
 * 部屋を出たら通話もやめる。切断した人との接続は閉じる。
 * session-store と互いに読み込み合うので、読み込みの途中ではなく最初に通話に入るときに見張り始める
 */
function startSync() {
  if (syncing) return;
  syncing = true;
  useSession.subscribe((s, prev) => {
    if (s.room !== 'active' && prev.room === 'active') useCall.getState().leave();
    for (const j of s.snapshot?.judges ?? []) {
      if (!j.connected && prev.snapshot?.judges.find((x) => x.judgeId === j.judgeId)?.connected) {
        client?.forget(j.judgeId);
        useCall.setState((st) => ({ inCallOthers: { ...st.inCallOthers, [j.judgeId]: false } }));
      }
    }
  });
}

const sameFlags = (a: Record<string, boolean>, b: Record<string, boolean>) => {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => b[k]);
};

export const useCall = create<CallStore>((set, get) => {
  const getClient = () =>
    (client ??= new CallClient(
      {
        me: callId,
        sendState: (on) =>
          useSession.getState().client?.sendEphemeral('CALL_STATE', useSession.getState().judgeId ? { on } : { on, as: spectatorCallId }),
        sendSignal: (signal) => useSession.getState().client?.sendEphemeral('RTC_SIGNAL', signal),
      },
      {
        onPeers: (peers) => set({ peers }),
        onSpeaking: (speaking) => {
          if (!sameFlags(get().speaking, speaking)) set({ speaking });
        },
        onError: (message) => useDisplay.getState().toast(message, 'warn'),
      },
    ));

  // 開発中だけ、ブラウザのコンソールから通話の中身を見られるようにする
  if (import.meta.env.DEV) (window as unknown as { __call?: () => CallClient | null }).__call = () => client;
  return {
    inCall: false,
    joining: false,
    muted: false,
    blocked: false,
    listenOnly: false,
    async retryMic() {
      client?.leave();
      set({ inCall: false, peers: [], speaking: {}, muted: false });
      await get().join();
    },
    async unlock() {
      await client?.resume();
      set({ blocked: !!client?.audioBlocked });
      // 文字起こしの AudioContext もクリックのあとでないと動かないので、ここで始め直す
      if (get().inCall && !get().muted) {
        useVoice.getState().setActive(false);
        useVoice.getState().setActive(true);
      }
    },
    peers: [],
    speaking: {},
    inCallOthers: {},
    async join() {
      if (get().inCall || get().joining) return;
      set({ joining: true });
      startSync();
      const c = getClient();
      // 観覧者（5人目以降）は話せない。聞くだけで入る
      await c.join({ listenOnly: !useSession.getState().judgeId });
      c.setMuted(get().muted);
      set({ joining: false, inCall: c.inCall, blocked: c.audioBlocked, listenOnly: c.listenOnly });
      if (!c.inCall) return;
      // 声は既定で届く。ミュートでなければ文字起こしも一緒に始める（聞くだけのときは始めない）
      if (!get().muted && !c.listenOnly) useVoice.getState().setActive(true);
      // まだクリックしていないページでは音が鳴らない。最初のクリックで鳴らし始める
      if (c.audioBlocked) {
        const once = () => void get().unlock();
        window.addEventListener('pointerdown', once, { once: true });
        window.addEventListener('keydown', once, { once: true });
      }
    },
    leave() {
      client?.leave();
      useVoice.getState().setActive(false);
      set({ inCall: false, peers: [], speaking: {} });
    },
    toggleMute() {
      const muted = !get().muted;
      client?.setMuted(muted);
      set({ muted });
      useVoice.getState().setActive(!muted && get().inCall);
    },
  };
});

/** CAMP の Ephemeral から呼ぶ */
function onCallState(from: string, on: boolean) {
  useCall.setState((s) => ({ inCallOthers: { ...s.inCallOthers, [from]: on } }));
  client?.onState(from, on);
}

function onCallSignal(from: string, signal: CallSignal) {
  void client?.onSignal(from, signal).catch(() => {});
}

onEphemeral('CALL_STATE', (from, payload) => onCallState(from, (payload as { on: boolean }).on));
onEphemeral('RTC_SIGNAL', (from, payload) => onCallSignal(from, payload as CallSignal));

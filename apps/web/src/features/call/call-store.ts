import { create } from 'zustand';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { CallClient, type CallSignal } from './call-client.ts';

interface CallStore {
  inCall: boolean;
  joining: boolean;
  muted: boolean;
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
        me: () => useSession.getState().judgeId,
        sendState: (on) => useSession.getState().client?.sendEphemeral('CALL_STATE', { on }),
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
    peers: [],
    speaking: {},
    inCallOthers: {},
    async join() {
      if (get().inCall || get().joining) return;
      set({ joining: true });
      startSync();
      const c = getClient();
      await c.join();
      set({ joining: false, inCall: c.inCall });
    },
    leave() {
      client?.leave();
      set({ inCall: false, peers: [], speaking: {} });
    },
    toggleMute() {
      const muted = !get().muted;
      client?.setMuted(muted);
      set({ muted });
    },
  };
});

/** CAMP の Ephemeral から呼ぶ（session-store の handleEphemeral） */
export function onCallState(from: string, on: boolean) {
  useCall.setState((s) => ({ inCallOthers: { ...s.inCallOthers, [from]: on } }));
  client?.onState(from, on);
}

export function onCallSignal(from: string, signal: CallSignal) {
  void client?.onSignal(from, signal).catch(() => {});
}

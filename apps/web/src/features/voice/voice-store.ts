import { create } from 'zustand';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { VoiceClient, type VoiceState } from './voice-client.ts';

interface VoiceStore {
  state: VoiceState;
  interim: string;
  toggle(): void;
}

let client: VoiceClient | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const useVoice = create<VoiceStore>((set, get) => {
  const getClient = () =>
    (client ??= new VoiceClient({
      onState: (state, reason) => {
        set({ state, ...(state !== 'listening' && state !== 'starting' ? { interim: '' } : {}) });
        const on = state === 'listening' || state === 'starting';
        useSession.getState().client?.sendEphemeral('MIC_STATE_CHANGED', { on });
        if (state === 'unavailable' && reason) useDisplay.getState().toast(reason, 'warn');
      },
      onInterim: (text) => set({ interim: text }),
      onFinal: (text) => {
        set({ interim: text });
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => set({ interim: '' }), 1500);
      },
    }));

  // 詳細を開いているキャラを、名前を言わなかったときの宛先にする
  useDisplay.subscribe((s, prev) => {
    if (s.selected !== prev.selected) client?.setTarget(s.selected);
  });

  return {
    state: 'off',
    interim: '',
    toggle() {
      const c = getClient();
      const { state } = get();
      if (state === 'listening' || state === 'starting') {
        c.stop();
        return;
      }
      const { sessionId, judgeId } = useSession.getState();
      if (!judgeId) return;
      c.setTarget(useDisplay.getState().selected);
      void c.start(sessionId, judgeId);
    },
  };
});

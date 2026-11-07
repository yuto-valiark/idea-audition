import { VoiceServerMessage } from '@idea-audition/protocol';
import workletUrl from './pcm-worklet.js?url&no-inline';

export type VoiceState = 'off' | 'starting' | 'listening' | 'unavailable';

interface Handlers {
  onState(state: VoiceState, reason?: string): void;
  onInterim(text: string): void;
  onFinal(text: string): void;
}

function voiceUrl() {
  const configured = import.meta.env.VITE_VOICE_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/voice`;
}

/**
 * マイク → 16kHz PCM → /voice（サーバー経由で Gemini Live）。
 * マイク OFF で接続ごと閉じる（音声を流している間だけ費用がかかる）。
 */
export class VoiceClient {
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private target: string | null = null;
  private active = false;

  constructor(private readonly handlers: Handlers) {}

  async start(sessionId: string, judgeId: string, accessCode?: string) {
    if (this.active) return;
    this.active = true;
    this.handlers.onState('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.stop();
      this.handlers.onState('unavailable', 'マイクを使えません（ブラウザの許可を確認してください）');
      return;
    }
    if (!this.active) return;

    const ws = new WebSocket(voiceUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ kind: 'voice_hello', sessionId, judgeId, accessCode }));
      ws.send(JSON.stringify({ kind: 'voice_target', instanceId: this.target }));
    };
    ws.onmessage = (e) => {
      let json: unknown;
      try {
        json = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const parsed = VoiceServerMessage.safeParse(json);
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.kind === 'voice_ready') this.handlers.onState('listening');
      else if (m.kind === 'voice_interim') this.handlers.onInterim(m.text);
      else if (m.kind === 'voice_final') this.handlers.onFinal(m.text);
      else if (m.kind === 'voice_unavailable') {
        this.stop();
        this.handlers.onState('unavailable', m.reason);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.active) {
        this.stop();
        this.handlers.onState('unavailable', '音声の接続が切れました。もう一度マイクをONにするか、テキストで入力してください');
      }
    };

    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(workletUrl);
    if (!this.active || !this.stream) return;
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-downsampler');
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    source.connect(this.node);
  }

  setTarget(instanceId: string | null) {
    this.target = instanceId;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ kind: 'voice_target', instanceId }));
  }

  stop() {
    const wasActive = this.active;
    this.active = false;
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close();
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (wasActive) this.handlers.onState('off');
  }
}

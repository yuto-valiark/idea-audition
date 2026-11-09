import { useSyncExternalStore } from 'react';

/**
 * 効果音（C3）。音のファイルは使わず、Web Audio でその場で鳴らす（著作物の心配がなく、読み込みも要らない）。
 * ブラウザはユーザーが画面を押すまで音を出せないので、最初のクリックで AudioContext を起こす。
 * 消音の設定はこの端末に覚える（localStorage）。
 */

export type SfxName = 'buzz' | 'allPressed' | 'pass' | 'leave' | 'tick' | 'champion';

type Tone = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number };

/** 音ごとの中身（開始秒・長さ・周波数）。音量は控えめにする（会話のじゃまをしない） */
export const SFX_TONES: Record<SfxName, readonly Tone[]> = {
  // ブザー：短く「ブッ」
  buzz: [{ freq: 220, at: 0, dur: 0.12, type: 'square', gain: 0.05 }],
  // 全員が押した：上がる2音
  allPressed: [
    { freq: 660, at: 0, dur: 0.1, type: 'triangle' },
    { freq: 990, at: 0.09, dur: 0.16, type: 'triangle' },
  ],
  // 合格：ドミソド
  pass: [
    { freq: 523, at: 0, dur: 0.14, type: 'triangle' },
    { freq: 659, at: 0.12, dur: 0.14, type: 'triangle' },
    { freq: 784, at: 0.24, dur: 0.14, type: 'triangle' },
    { freq: 1047, at: 0.36, dur: 0.4, type: 'triangle' },
  ],
  // 見送り・時間切れ：下がる「ひゅるる」
  leave: [{ freq: 520, at: 0, dur: 0.45, type: 'sine', slideTo: 180, gain: 0.07 }],
  // 残り数秒：小さな「コッ」
  tick: [{ freq: 1200, at: 0, dur: 0.04, type: 'square', gain: 0.025 }],
  // 優勝：ファンファーレ
  champion: [
    { freq: 523, at: 0, dur: 0.12, type: 'sawtooth', gain: 0.05 },
    { freq: 523, at: 0.13, dur: 0.12, type: 'sawtooth', gain: 0.05 },
    { freq: 523, at: 0.26, dur: 0.12, type: 'sawtooth', gain: 0.05 },
    { freq: 698, at: 0.4, dur: 0.5, type: 'sawtooth', gain: 0.05 },
    { freq: 880, at: 0.4, dur: 0.5, type: 'triangle', gain: 0.05 },
    { freq: 1047, at: 0.95, dur: 0.7, type: 'triangle', gain: 0.07 },
  ],
};

const MUTE_KEY = 'ia.sfx.muted';
const listeners = new Set<() => void>();
let muted = readMuted();
let ctx: AudioContext | null = null;

function readMuted() {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // 保存できない環境（プライベートモードなど）では、この画面のあいだだけ覚える
  }
  listeners.forEach((l) => l());
}

export function useMuted() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isMuted,
    isMuted,
  );
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** 最初のクリックで音を出せるようにする（main.tsx から一度だけ呼ぶ） */
export function unlockSfxOnFirstGesture() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    void audio()?.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function playSfx(name: SfxName) {
  if (muted) return;
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const start = ac.currentTime + 0.01;
  for (const t of SFX_TONES[name]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start + t.at);
    if (t.slideTo) osc.frequency.exponentialRampToValueAtTime(t.slideTo, start + t.at + t.dur);
    const peak = t.gain ?? 0.06;
    gain.gain.setValueAtTime(0.0001, start + t.at);
    gain.gain.exponentialRampToValueAtTime(peak, start + t.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + t.at + t.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(start + t.at);
    osc.stop(start + t.at + t.dur + 0.02);
  }
}

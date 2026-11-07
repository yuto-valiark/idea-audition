import { create } from 'zustand';

/**
 * 表示状態（アニメーション・操作中の一時状態）。
 * 業務状態（サーバーの snapshot）とは別に持ち、アニメーションの完了を業務状態の根拠にしない（ADR-0002）。
 */

export interface Point {
  x: number;
  y: number;
}

export interface DragState {
  instanceId: string;
  designId: number;
  pointer: Point;
  /** 'dragging'：つかんで移動中、'pending'：上段にドロップしてサーバーの確定待ち */
  phase: 'dragging' | 'pending';
}

export interface Flight {
  flightId: string;
  instanceId: string;
  designId: number;
  from: Point;
  /** 'upper'：上段の位置へ飛ぶ、'return'：元の下段へ戻る、'box'：退場して Idea BOX へ入る */
  kind: 'upper' | 'return' | 'box';
}

export interface RemoteCursor {
  x: number;
  y: number;
  updatedAt: number;
}

export interface Bubble {
  text: string;
  toInstanceId: string;
  critiqueId: string;
}

export interface Caption {
  id: string;
  judgeId: string;
  text: string;
  source: 'live' | 'text';
  intent: 'question' | 'instruction' | 'comment';
  targetInstanceId: string | null;
}

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'warn' | 'gold';
}

interface DisplayState {
  drag: DragState | null;
  flights: Flight[];
  /** 飛行中のため上段に表示しない（同じキャラを2か所に出さない、AC-05） */
  arriving: Set<string>;
  /** 移動中のため下段に表示しない */
  departing: Set<string>;
  cursors: Record<string, RemoteCursor>;
  heldBy: Record<string, string>; // judgeId → instanceId
  bubbles: Record<string, Bubble>; // fromInstanceId → bubble
  toasts: Toast[];
  selected: string | null;
  ideaBoxOpen: boolean;
  justUpdated: Record<string, number>; // instanceId → 改良版が公開された時刻
  /** 他の審査員のマイク状態（Ephemeral） */
  micOn: Record<string, boolean>;
  setMic(judgeId: string, on: boolean): void;
  /** 審査員の発言（直近のもの） */
  captions: Caption[];
  addCaption(c: Omit<Caption, 'id'>): void;
  dismissCaption(id: string): void;
  /** 自分の投票先（サーバーは締め切りまで投票先を公開しないため手元で持つ） */
  myVote: string | null;
  setMyVote(instanceId: string | null): void;

  setDrag(d: DragState | null): void;
  addFlight(f: Omit<Flight, 'flightId'>): void;
  finishFlight(flightId: string): void;
  setCursor(judgeId: string, c: RemoteCursor | null): void;
  setHeld(judgeId: string, instanceId: string | null): void;
  setBubble(from: string, b: Bubble | null): void;
  clearBubbles(): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: string): void;
  select(instanceId: string | null): void;
  setIdeaBoxOpen(open: boolean): void;
  markUpdated(instanceId: string): void;
}

let n = 0;

export const useDisplay = create<DisplayState>((set) => ({
  drag: null,
  flights: [],
  arriving: new Set(),
  departing: new Set(),
  cursors: {},
  heldBy: {},
  bubbles: {},
  toasts: [],
  selected: null,
  ideaBoxOpen: false,
  justUpdated: {},
  micOn: {},
  setMic: (judgeId, on) => set((s) => ({ micOn: { ...s.micOn, [judgeId]: on } })),
  captions: [],
  addCaption: (c) => set((s) => ({ captions: [...s.captions.slice(-2), { ...c, id: `c${++n}` }] })),
  dismissCaption: (id) => set((s) => ({ captions: s.captions.filter((c) => c.id !== id) })),
  myVote: null,
  setMyVote: (myVote) => set({ myVote }),

  setDrag: (drag) => set({ drag }),
  addFlight: (f) =>
    set((s) => {
      const flight = { ...f, flightId: `f${++n}` };
      const arriving = new Set(s.arriving);
      const departing = new Set(s.departing);
      if (f.kind === 'upper') arriving.add(f.instanceId);
      else if (f.kind === 'return') departing.add(f.instanceId);
      return { flights: [...s.flights, flight], arriving, departing };
    }),
  finishFlight: (flightId) =>
    set((s) => {
      const f = s.flights.find((x) => x.flightId === flightId);
      if (!f) return {};
      const arriving = new Set(s.arriving);
      const departing = new Set(s.departing);
      arriving.delete(f.instanceId);
      departing.delete(f.instanceId);
      return { flights: s.flights.filter((x) => x.flightId !== flightId), arriving, departing };
    }),
  setCursor: (judgeId, c) =>
    set((s) => {
      const cursors = { ...s.cursors };
      if (c) cursors[judgeId] = c;
      else delete cursors[judgeId];
      return { cursors };
    }),
  setHeld: (judgeId, instanceId) =>
    set((s) => {
      const heldBy = { ...s.heldBy };
      if (instanceId) heldBy[judgeId] = instanceId;
      else delete heldBy[judgeId];
      return { heldBy };
    }),
  setBubble: (from, b) =>
    set((s) => {
      const bubbles = { ...s.bubbles };
      if (b) bubbles[from] = b;
      else delete bubbles[from];
      // 同時に表示する吹き出しは最大2つ（ADR-0005 §6）
      const keys = Object.keys(bubbles);
      while (keys.length > 2) delete bubbles[keys.shift()!];
      return { bubbles };
    }),
  clearBubbles: () => set({ bubbles: {} }),
  toast: (text, tone = 'info') =>
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id: `t${++n}`, text, tone }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  select: (selected) => set({ selected }),
  setIdeaBoxOpen: (ideaBoxOpen) => set({ ideaBoxOpen }),
  markUpdated: (instanceId) => set((s) => ({ justUpdated: { ...s.justUpdated, [instanceId]: Date.now() } })),
}));

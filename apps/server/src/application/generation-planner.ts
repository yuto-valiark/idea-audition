import { JUDGE_SLOTS, TASTE_AXES, type PitchRole } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';
import type { IdeaDraft, Pitch } from '../domain/types.ts';
import { sample, type Candidate } from '../domain/selection.ts';
import {
  CONFIDENT_SIGNALS,
  divergence,
  normalized,
  strongestAxes,
  teamTaste,
  zeros,
  type Vec,
} from '../domain/taste.ts';
import { PERSONAS } from './personas.ts';
import type { GenerationSlot, TasteHint } from './ports.ts';

/**
 * 生成計画と選抜（ADR-0009 §2-2）。
 * - 生成：枠ごとに役割（fit / bridge / explore / wildcard）と発想の型を決めて Gemini に頼む
 * - 選抜：下段に空きが出たら、そのときの好みでストックから1つ選ぶ（多めに作って選ぶ）
 */

const AXIS_LABEL = TASTE_AXES.map((a) => a.label);
/** 好みが溜まってからの役割の回り方 */
const WARM_ROTATION: PitchRole[] = ['fit', 'bridge', 'explore', 'fit', 'wildcard'];
/** 好みが溜まるまでは広く探る */
const COLD_ROTATION: PitchRole[] = ['explore', 'wildcard', 'explore', 'explore'];

export interface PlannerState {
  /** 役割の回り方のどこまで来たか */
  cursor: number;
  /** 次に「好み枠」で寄せる審査員（順番に回す） */
  fitTurn: number;
}

export const newPlannerState = (): PlannerState => ({ cursor: 0, fitTurn: 0 });

const judgeLabel = (s: AuditionSession, judgeId: string) => {
  const j = s.judges.find((x) => x.judgeId === judgeId);
  return j ? JUDGE_SLOTS[j.slotIndex]!.label : '審査員';
};
/** カードに出す短い呼び方（「審査員 A」→「Aさん」） */
const shortLabel = (s: AuditionSession, judgeId: string) => judgeLabel(s, judgeId).replace('審査員 ', '') + 'さん';

function describeAxis(axis: number, value: number) {
  return `${AXIS_LABEL[axis]}${value > 0 ? '高め' : '控えめ'}`;
}

function confidentJudges(s: AuditionSession) {
  return s.judges.filter((j) => (s.taste.judges[j.judgeId]?.signals ?? 0) >= CONFIDENT_SIGNALS).map((j) => j.judgeId);
}

/** 次の枠の役割と、寄せる相手 */
function nextRole(s: AuditionSession, state: PlannerState, now: number): { role: PitchRole; judgeIds: string[] } {
  const confident = confidentJudges(s);
  if (confident.length === 0) {
    const role = COLD_ROTATION[state.cursor++ % COLD_ROTATION.length]!;
    return { role, judgeIds: [] };
  }
  let role = WARM_ROTATION[state.cursor++ % WARM_ROTATION.length]!;
  const div = divergence(s.taste, s.judges.map((j) => j.judgeId), now);
  if (role === 'bridge') {
    if (div) return { role, judgeIds: [div.judgeA, div.judgeB] };
    role = 'fit';
  }
  if (role === 'fit') {
    const judgeId = confident[state.fitTurn++ % confident.length]!;
    return { role, judgeIds: [judgeId] };
  }
  return { role, judgeIds: [] };
}

/** 生成を頼む枠を n 個決める */
export function planSlots(s: AuditionSession, state: PlannerState, n: number, now: number): GenerationSlot[] {
  const slots: GenerationSlot[] = [];
  // 生成用の回り方は選抜用とずらして、同じ役割ばかり作らないようにする
  const local: PlannerState = { cursor: state.cursor + 1, fitTurn: state.fitTurn };
  for (let i = 0; i < n; i++) {
    const { role, judgeIds } = nextRole(s, local, now);
    const persona = PERSONAS[(state.cursor * 3 + i * 5 + s.ideas.size) % PERSONAS.length]!;
    slots.push({ role, direction: directionFor(s, role, judgeIds, now), persona: { name: persona.name, how: persona.how } });
  }
  return slots;
}

function directionFor(s: AuditionSession, role: PitchRole, judgeIds: string[], now: number): string {
  if (role === 'fit' && judgeIds[0]) {
    const top = strongestAxes(normalized(s.taste.judges[judgeIds[0]], now));
    const want = top.map((a) => describeAxis(a.axis, a.value)).join('・');
    return `${judgeLabel(s, judgeIds[0])}が好む方向（${want || 'これまで選んだ案に近いもの'}）に寄せた案`;
  }
  if (role === 'bridge' && judgeIds.length === 2) {
    const div = divergence(s.taste, judgeIds, now);
    const axis = div ? AXIS_LABEL[div.axis] : '方向性';
    return `${judgeLabel(s, judgeIds[0]!)}は「${axis}」が高い案、${judgeLabel(s, judgeIds[1]!)}は低い案を好む。両方が「それならいい」と言える、両立・折衷の案`;
  }
  if (role === 'wildcard') return '常識を外した、意外で大胆な案（好みは気にしなくてよい）';
  const shownMean = meanProfile(shownIdeas(s).map((x) => x.profile));
  const top = strongestAxes(shownMean, 1, 0.15)[0];
  return top
    ? `これまでの案は「${describeAxis(top.axis, top.value)}」に偏っている。その逆の方向の案`
    : 'まだ出ていない方向の案';
}

/** 生成に渡す好みの要約 */
export function tasteHint(s: AuditionSession, slots: GenerationSlot[], now: number): TasteHint {
  const judges = s.judges
    .filter((j) => (s.taste.judges[j.judgeId]?.signals ?? 0) > 0)
    .map((j) => {
      const v = normalized(s.taste.judges[j.judgeId], now);
      const axes = strongestAxes(v, 3, 0.15);
      return {
        label: JUDGE_SLOTS[j.slotIndex]!.label,
        likes: axes.filter((a) => a.value > 0).map((a) => `${AXIS_LABEL[a.axis]}が高い`),
        dislikes: axes.filter((a) => a.value < 0).map((a) => `${AXIS_LABEL[a.axis]}が高い`),
      };
    });
  const div = divergence(s.taste, s.judges.map((j) => j.judgeId), now);
  return {
    judges,
    divergence: div ? `${judgeLabel(s, div.judgeA)}と${judgeLabel(s, div.judgeB)}は「${AXIS_LABEL[div.axis]}」で好みが割れている` : null,
    slots,
  };
}

/* ------------------------------ 選抜 ------------------------------ */

function meanProfile(vs: Vec[]): Vec {
  if (vs.length === 0) return zeros();
  return zeros().map((_, i) => vs.reduce((a, v) => a + (v[i] ?? 0), 0) / vs.length);
}

function shownIdeas(s: AuditionSession) {
  const onStage = new Set([...s.lowerSlots.filter((x): x is string => !!x), ...s.upper.map((f) => f.instanceId)]);
  const recentArchived = s.ideaBox.slice(-6).map((a) => a.ideaId);
  const ideaIds = new Set<string>(recentArchived);
  for (const id of onStage) {
    const c = s.characters.get(id);
    if (c) ideaIds.add(c.ideaId);
  }
  return [...ideaIds]
    .map((id) => s.ideas.get(id))
    .filter((i) => !!i)
    .map((i) => ({ title: i.revisions[0]!.title, profile: i.revisions.at(-1)!.profile ?? zeros() }));
}

/** 審査員が決勝に選んだ案の埋め込みの重心 */
function centroidOf(s: AuditionSession, judgeId: string, embed: (title: string) => Vec | null): Vec | null {
  const vecs = s.decisions
    .filter((d) => d.kind === 'promoted' && d.judgeId === judgeId)
    .map((d) => embed(d.title))
    .filter((v): v is Vec => !!v);
  if (vecs.length === 0) return null;
  return vecs[0]!.map((_, i) => vecs.reduce((a, v) => a + v[i]!, 0) / vecs.length);
}

/**
 * 空いた枠に出す1案をストックから選ぶ。役割に合う候補を MMR つきで点数にし、温度つきで抽選する。
 */
export function chooseFromStock(
  s: AuditionSession,
  state: PlannerState,
  stock: readonly IdeaDraft[],
  embed: (title: string) => Vec | null,
  now: number,
  rng: () => number,
): { index: number; pitch: Pitch | null } | null {
  if (stock.length === 0) return null;
  const { role, judgeIds } = nextRole(s, state, now);
  const shown = shownIdeas(s).map((x) => ({ profile: x.profile, embedding: embed(x.title) }));
  const targets =
    role === 'fit' || role === 'bridge'
      ? judgeIds.length
        ? judgeIds.map((j) => normalized(s.taste.judges[j], now))
        : [teamTaste(s.taste, s.judges.map((j) => j.judgeId), now)]
      : [];
  const centroids = judgeIds.map((j) => centroidOf(s, j, embed));
  const candidates: Candidate[] = stock.map((d, index) => ({
    index,
    profile: d.profile ?? zeros(),
    embedding: embed(d.title),
  }));
  const picked = sample(candidates, { role, targets, centroids, shown, mu: 0.35, temperature: 0.12 }, rng);
  if (!picked) return null;
  return { index: picked.index, pitch: pitchFor(s, role, judgeIds, stock[picked.index]!, now) };
}

function pitchFor(s: AuditionSession, role: PitchRole, judgeIds: string[], draft: IdeaDraft, now: number): Pitch {
  if (role === 'fit' && judgeIds[0]) {
    const taste = normalized(s.taste.judges[judgeIds[0]], now);
    // 好みとこの案が両方強い軸を理由にする
    const shared = (draft.profile ?? zeros())
      .map((v, axis) => ({ axis, value: v, score: v * taste[axis]! }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    const why = shared ? describeAxis(shared.axis, shared.value) : 'これまでの反応から';
    return { role, judgeIds, reason: `${shortLabel(s, judgeIds[0])}好み：${why}` };
  }
  if (role === 'bridge' && judgeIds.length === 2) {
    return { role, judgeIds, reason: `${shortLabel(s, judgeIds[0]!)}と${shortLabel(s, judgeIds[1]!)}の間をとる案` };
  }
  if (role === 'explore') return { role, judgeIds: [], reason: 'まだ出ていない方向' };
  return { role, judgeIds: [], reason: 'ワイルドカード' };
}

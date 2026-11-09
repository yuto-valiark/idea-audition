import { describe, expect, it } from 'vitest';
import { activeTasteJudges } from './taste-summary.ts';

const judges = [
  { judgeId: 'a', label: 'ゆうと', color: '#f00' },
  { judgeId: 'b', label: 'さき', color: '#0f0' },
  { judgeId: 'c', label: 'けん', color: '#00f' },
];

describe('activeTasteJudges', () => {
  it('returns no judges when nobody has reacted yet', () => {
    const taste = { judges: {}, signals: {} };
    expect(activeTasteJudges(taste, judges)).toEqual([]);
  });

  it('returns only judges with at least one reaction and a taste vector, in judge order', () => {
    const v = [0, 0, 0, 0, 0, 0, 0, 0];
    const taste = { judges: { a: v, b: v, c: v }, signals: { a: 0, b: 3, c: 1 } };
    expect(activeTasteJudges(taste, judges).map((j) => j.judgeId)).toEqual(['b', 'c']);
  });

  it('skips a judge whose reaction count is positive but has no taste vector yet', () => {
    const taste = { judges: {}, signals: { a: 2 } };
    expect(activeTasteJudges(taste, judges)).toEqual([]);
  });
});

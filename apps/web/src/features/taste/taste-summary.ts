import type { TasteView } from '@idea-audition/protocol';

type TasteSignals = Pick<TasteView, 'judges' | 'signals'>;

/**
 * 好みが読み取れている審査員（反応が1回以上あり、好みの値がある人）だけを、審査員の並び順のまま返す。
 * レーダーに形を描く人・凡例に出す人・「まだ分からない」と出すかの判定に使う。
 */
export function activeTasteJudges<J extends { judgeId: string }>(taste: TasteSignals, judges: readonly J[]): J[] {
  return judges.filter((j) => !!taste.judges[j.judgeId] && (taste.signals[j.judgeId] ?? 0) > 0);
}

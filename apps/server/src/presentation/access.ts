import { timingSafeEqual } from 'node:crypto';

/**
 * 公開環境の合言葉。ACCESS_CODE が未設定（ローカル開発）なら誰でも入れる。
 * 比較は時間差で中身が推測されないよう timingSafeEqual で行う。
 */
export function checkAccess(expected: string | null, given: string | undefined): 'ok' | 'required' | 'invalid' {
  if (!expected) return 'ok';
  if (!given) return 'required';
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

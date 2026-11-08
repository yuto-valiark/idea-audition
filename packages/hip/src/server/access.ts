import { timingSafeEqual } from 'node:crypto';

/**
 * 合言葉の照合（hello の accessCode）。expected が null なら誰でも入れる。
 * 時間差で中身が推測されないよう timingSafeEqual で比べる。
 */
export function checkAccess(expected: string | null | undefined, given: string | undefined): 'ok' | 'required' | 'invalid' {
  if (!expected) return 'ok';
  if (!given) return 'required';
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

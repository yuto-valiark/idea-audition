import { describe, expect, it } from 'vitest';
import { checkAccess } from '../src/presentation/access.ts';

describe('合言葉', () => {
  it('未設定なら誰でも入れる（ローカル開発）', () => {
    expect(checkAccess(null, undefined)).toBe('ok');
  });
  it('設定されていれば、無い・違うは拒否、一致すれば通す（前後の空白は無視）', () => {
    expect(checkAccess('victory-2026', undefined)).toBe('required');
    expect(checkAccess('victory-2026', 'victory')).toBe('invalid');
    expect(checkAccess('victory-2026', ' victory-2026 ')).toBe('ok');
  });
});

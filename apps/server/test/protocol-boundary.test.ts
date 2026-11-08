import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResultCache, SeqGate } from '@idea-audition/protocol';

const coreDir = join(import.meta.dirname, '../../../packages/protocol/src/core');

describe('HIP core の境界（ADR-0010 §5）', () => {
  it('core/ はアプリの語彙（vocabulary/）や他のパッケージを import しない', () => {
    for (const file of readdirSync(coreDir)) {
      const src = readFileSync(join(coreDir, file), 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec === 'zod' || spec.startsWith('./'), `${file} imports ${spec}`).toBe(true);
      }
    }
  });

  it('ResultCache：同じ送り手と commandId には同じ結果、上限を超えたら古いものから捨てる', () => {
    const c = new ResultCache<string>(2);
    c.set('a', '1', 'ok');
    c.set('b', '1', 'ng');
    expect(c.get('a', '1')).toBe('ok');
    expect(c.get('b', '1')).toBe('ng');
    c.set('a', '2', 'x');
    expect(c.get('a', '1')).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it('SeqGate：古い・重複した seq を捨て、snapshot で数え直す', () => {
    const g = new SeqGate();
    expect(g.accept(3)).toBe(true);
    expect(g.accept(3)).toBe(false);
    expect(g.accept(2)).toBe(false);
    expect(g.accept(4)).toBe(true);
    g.reset(10);
    expect(g.accept(9)).toBe(false);
    expect(g.accept(11)).toBe(true);
  });
});

/**
 * 1回選んだだけで同じ方向の案ばかりにならないための仕組み（プレイテスト 2026-11-08 の P0-1）。
 */
import { describe, expect, it } from 'vitest';
import { roleScore, type Candidate } from '../src/domain/selection.ts';
import { GeminiGateway, type GenerateContentClient } from '../src/infrastructure/gemini/gemini-gateway.ts';

const vec = (...xs: number[]) => [...xs, ...Array(8 - xs.length).fill(0)];

describe('同じ方向ばかりにしない', () => {
  it('探る枠・ワイルドカードでは、決勝の案に近い候補ほど点が下がる', () => {
    const food = { profile: vec(1, 0, 0), embedding: [1, 0, 0] };
    const near: Candidate = { index: 0, profile: vec(0.9, 0.1, 0), embedding: [0.95, 0.05, 0] };
    const far: Candidate = { index: 1, profile: vec(0, 0, 1), embedding: [0, 0, 1] };
    for (const role of ['explore', 'wildcard'] as const) {
      const ctx = { role, targets: [], centroids: [], shown: [], finalists: [food], mu: 0.35, temperature: 0.12 };
      expect(roleScore(far, ctx)).toBeGreaterThan(roleScore(near, ctx));
      // 決勝が無いときは、決勝への近さで減点しない
      expect(roleScore(near, { ...ctx, finalists: [] })).toBeGreaterThan(roleScore(near, ctx));
    }
  });

  it('生成：合意や選ばれた案を伸ばすのは好み・折衷の枠だけ。ほかの枠には、それと別の側面から考えるよう頼む', async () => {
    const calls: string[] = [];
    const client: GenerateContentClient = {
      models: {
        async generateContent(params) {
          calls.push(`${JSON.stringify(params.config)}\n${params.contents}`);
          return {
            text: JSON.stringify({
              ideas: [{ slot: 0, title: '案', reading: 'アン', summary: 'a\nb', who: 'w', pain: 'p', how: 'h', icon: '☆', inspiredBy: [], note: '', profile: { cost: 0, novelty: 0, ease: 0, buzz: 0, sustain: 0, social: 0, scale: 0, reach: 0 } }],
            }),
          };
        },
      },
    };
    const g = new GeminiGateway(client, {
      fast: { model: 'f', thinkingLevel: 'MINIMAL', timeoutMs: 1000 },
      refine: { model: 'r', thinkingLevel: 'LOW', timeoutMs: 1000 },
    });
    await g.generateIdeas({
      theme: '商店街に若者を',
      count: 2,
      avoidTitles: [],
      context: {
        version: 1,
        agreed: [{ label: 'C1', text: '自炊が苦手な学生を支援する', supporters: ['審査員 A'] }],
        proposed: [],
        rejected: [],
        favoredIdeas: ['若者と街の夕食シェア食堂'],
        rejectedIdeas: [],
        recentRemarks: [],
      },
    });
    expect(calls[0]).toContain('すべての案をその方向に寄せる」という意味ではない');
    expect(calls[0]).toContain('伸ばしてよいのは、方向が「〜が好む方向」「両立・折衷」の枠だけ');
    expect(calls[0]).toContain('テーマの別の側面から考える：若者と街の夕食シェア食堂／自炊が苦手な学生を支援する');
  });
});

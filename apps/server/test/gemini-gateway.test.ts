import { describe, expect, it } from 'vitest';
import { GeminiGateway, type GenerateContentClient } from '../src/infrastructure/gemini/gemini-gateway.ts';
import { ResilientGateway } from '../src/infrastructure/resilient-gateway.ts';
import { StubAi } from './helpers.ts';

const config = {
  fast: { model: 'fast-model', thinkingLevel: 'MINIMAL' as const, timeoutMs: 1000 },
  refine: { model: 'refine-model', thinkingLevel: 'LOW' as const, timeoutMs: 1000 },
};

function fakeClient(responses: (string | Error)[]) {
  const calls: { model: string; contents: string; config: Record<string, unknown> }[] = [];
  const client: GenerateContentClient = {
    models: {
      async generateContent(params) {
        calls.push(params);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return { text: next };
      },
    },
  };
  return { client, calls };
}

const participants = [
  { instanceId: 'ch_a', characterName: 'MOMO', title: '案A', summary: 'a1\na2', version: 1 },
  { instanceId: 'ch_b', characterName: 'LUNA', title: '案B', summary: 'b1\nb2', version: 2 },
];

describe('GeminiGateway', () => {
  it('案の生成：改行の二重エスケープを直し、2行・指定件数に整える', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({
        ideas: [
          { title: 'ガチャ学食', summary: '何が出るかお楽しみ\\n日替わりメニュー\\n3行目', icon: '☆' },
          { title: '郷土の味', summary: '全国の味を\n週替わりで', icon: '◎' },
        ],
      }),
    ]);
    const g = new GeminiGateway(client, config);
    const ideas = await g.generateIdeas({ theme: '学食', count: 1, avoidTitles: [] });
    expect(ideas).toEqual([{ title: 'ガチャ学食', summary: '何が出るかお楽しみ\n日替わりメニュー', icon: '☆' }]);
    expect(calls[0]!.model).toBe('fast-model');
    expect(calls[0]!.config.responseMimeType).toBe('application/json');
  });

  it('改良：話し手と相手は決めた順番を使い、P1/P2 を instanceId に戻す', async () => {
    const { client, calls } = fakeClient([
      JSON.stringify({
        critiques: [
          { round: 1, text: 'コストを下げよう' },
          { round: 2, text: '対象を絞ったら？' },
        ],
        revisions: [
          { participant: 'P2', title: '案B+', summary: 'x\ny', keepStrengths: ['強み'], improvementPoints: ['改善1', '改善2'], reason: '指摘を反映' },
          { participant: 'P9', title: '不明', summary: 'z', keepStrengths: ['a'], improvementPoints: ['b'], reason: 'c' },
          { participant: 'P1', title: '案A+', summary: 'p\nq', keepStrengths: ['強み'], improvementPoints: ['改善'], reason: '反映' },
        ],
      }),
    ]);
    const g = new GeminiGateway(client, config);
    const out = await g.refine({
      theme: '学食', trigger: 'arrival', participants, targets: ['ch_a', 'ch_b'], rounds: 2, instruction: null,
    });
    expect(out.critiques).toEqual([
      { round: 1, fromInstanceId: 'ch_a', toInstanceId: 'ch_b', text: 'コストを下げよう' },
      { round: 2, fromInstanceId: 'ch_b', toInstanceId: 'ch_a', text: '対象を絞ったら？' },
    ]);
    expect(Object.keys(out.revisions).sort()).toEqual(['ch_a', 'ch_b']);
    expect(out.revisions.ch_b!.title).toBe('案B+');
    expect(calls[0]!.model).toBe('refine-model');
    expect(calls[0]!.contents).not.toContain('ch_a'); // モデルには内部IDを渡さない
  });

  it('不正な出力は1回やり直す', async () => {
    const { client, calls } = fakeClient(['{"ideas": "broken"}', JSON.stringify({ ideas: [{ title: 'T', summary: 'S', icon: '♡' }] })]);
    const g = new GeminiGateway(client, config);
    const ideas = await g.generateIdeas({ theme: '学食', count: 1, avoidTitles: [] });
    expect(ideas).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('2回とも失敗したら例外。ResilientGateway は固定データに切り替える', async () => {
    const { client } = fakeClient([new Error('timeout'), new Error('timeout')]);
    const g = new GeminiGateway(client, config);
    await expect(g.answer({ theme: 't', idea: { title: 'a', summary: 'b' }, characterName: 'MOMO', question: 'q' })).rejects.toThrow();

    const { client: c2 } = fakeClient([new Error('timeout'), new Error('timeout')]);
    const resilient = new ResilientGateway(new GeminiGateway(c2, config), new StubAi());
    await expect(resilient.answer({ theme: 't', idea: { title: 'a', summary: 'b' }, characterName: 'MOMO', question: 'q' })).resolves.toBe('回答:q');
  });

  it('使える改良版が1つもなければ例外（固定データに切り替えさせる）', async () => {
    const { client } = fakeClient([
      JSON.stringify({ critiques: [], revisions: [{ participant: 'P7', title: 'x', summary: 'y', keepStrengths: ['a'], improvementPoints: ['b'], reason: 'c' }] }),
    ]);
    const g = new GeminiGateway(client, config);
    await expect(
      g.refine({ theme: 't', trigger: 'promotion', participants: participants.slice(0, 1), targets: ['ch_a'], rounds: 0, instruction: null }),
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { CHARACTER_DESIGNS, HIP_VERSION, type CommandMessage, type EventMessage, type EphemeralMessage } from '@idea-audition/protocol';
import {
  DEFAULT_ROTATION_POLICY,
  addAttention,
  detectMention,
  newAttention,
  pickExitCandidate,
  type ExitCandidate,
} from '../src/domain/attention.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

const policy = { ...DEFAULT_ROTATION_POLICY, minStageMs: 10_000, baseIdleMs: 5_000, idlePerScoreMs: 2_000, maxIdleMs: 20_000 };

describe('会話での言及の検出', () => {
  const luna = { name: 'LUNA', readings: ['ルナ', 'るな'], title: '学食ガチャ' };
  it('名前（英字・カタカナ・ひらがな）を検出する', () => {
    expect(detectMention('ルナの案いいね', luna, '大学の学食')).toBe('name');
    expect(detectMention('るなさん', luna, '大学の学食')).toBe('name');
    expect(detectMention('luna推し', luna, '大学の学食')).toBe('name');
  });
  it('企画名の一部（3文字以上）を検出し、テーマの語やひらがなだけの部分は数えない', () => {
    expect(detectMention('ガチャのやつ面白い', luna, '大学の学食')).toBe('title');
    expect(detectMention('がちゃって楽しそう', luna, '大学の学食')).toBe('title');
    expect(detectMention('学食いいよね', luna, '大学の学食をもっと楽しく')).toBeNull();
    expect(detectMention('食べたい', { ...luna, title: 'ひとりでも食べたい' }, 'テーマ')).toBeNull();
    expect(detectMention('学食がいいね', luna, '大学の学食')).toBeNull();
    expect(detectMention('AR食堂の案', { ...luna, title: 'AR食堂ツアー' }, '大学の学食')).toBe('title');
  });
});

describe('退場させる案の選び方', () => {
  const now = 100_000;
  const c = (id: string, spawnedAgo: number, touchedAgo: number, score = 0): ExitCandidate => ({
    instanceId: id,
    spawnedAt: now - spawnedAgo,
    attention: { score, scoredAt: now, lastTouchAt: now - touchedAgo, mentions: 0 },
  });

  it('しばらく触れられていない案のうち、注目度が最も低い案を選ぶ', () => {
    const picked = pickExitCandidate([c('a', 60_000, 30_000, 3), c('b', 60_000, 30_000, 1), c('c', 60_000, 30_000, 2)], now, new Set(), policy);
    expect(picked).toBe('b');
  });

  it('登場したばかり・最近触れられた・保護中の案は選ばない', () => {
    expect(pickExitCandidate([c('new', 5_000, 5_000)], now, new Set(), policy)).toBeNull();
    expect(pickExitCandidate([c('touched', 60_000, 2_000)], now, new Set(), policy)).toBeNull();
    expect(pickExitCandidate([c('seen', 60_000, 30_000)], now, new Set(['seen']), policy)).toBeNull();
  });

  it('注目度が高いほど退場までの猶予が延びる', () => {
    // 触れられてから8秒：注目度0なら猶予5秒で候補、注目度3なら猶予11秒でまだ候補ではない
    expect(pickExitCandidate([c('cold', 60_000, 8_000, 0)], now, new Set(), policy)).toBe('cold');
    expect(pickExitCandidate([c('hot', 60_000, 8_000, 3)], now, new Set(), policy)).toBeNull();
  });

  it('注目度は時間とともに半減する', () => {
    const a = addAttention(newAttention(0), 'mentionName', 0, policy);
    expect(a.score).toBe(6);
    expect(a.mentions).toBe(1);
    const later = addAttention(a, 'hover', policy.halfLifeMs, policy);
    expect(later.score).toBeCloseTo(3 + 1);
  });
});

describe('アクターの入れ替え', () => {
  let cid = 0;
  const cmd = (type: CommandMessage['type'], payload: object) =>
    ({ hip: HIP_VERSION, kind: 'command', type, commandId: `a${++cid}`, sentAt: '', payload }) as CommandMessage;
  const eph = (type: EphemeralMessage['type'], payload: object) => ({ hip: HIP_VERSION, kind: 'ephemeral', type, payload }) as EphemeralMessage;

  async function setup() {
    const { scheduler, advance } = manualScheduler();
    let t = 1_700_000_000_000;
    const clock = { now: () => t };
    const tick = async (ms: number) => {
      for (let i = 0; i < ms / 500; i++) {
        t += 500;
        await advance(500);
      }
    };
    const actor = await SessionActor.open('r', {
      ai: new StubAi(),
      store: new MemorySessionStore(),
      scheduler,
      clock,
      ids: seqIds(),
      config: {
        stockTarget: 3,
        critiqueIntervalMs: 10,
        persistDelayMs: 10,
        rotation: { checkMs: 500, warningMs: 2_000, minGapMs: 3_000, policy },
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { hip: HIP_VERSION, kind: 'hello', sessionId: 'r' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: 'テーマ', mode: 'team' }));
    await advance(0);
    const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
    const judgeId = actor.session.judges[0]!.judgeId;
    return { actor, a, tick, events, judgeId };
  }

  it('触れられないと退場予告 → 退場し、Idea BOX に入る', async () => {
    const { actor, tick, events } = await setup();
    await tick(16_000);
    const leaving = events().find((e) => e.type === 'CANDIDATE_LEAVING');
    expect(leaving).toBeDefined();
    const id = leaving!.detail.instanceId as string;
    await tick(3_000);
    expect(events().some((e) => e.type === 'CANDIDATE_ARCHIVED' && e.detail.instanceId === id)).toBe(true);
    expect(actor.session.ideaBox.map((x) => x.instanceId)).toContain(id);
    expect(actor.session.lowerSlots.filter(Boolean)).toHaveLength(5);
  });

  it('退場予告中に触れると取り消される', async () => {
    const { actor, a, tick, events } = await setup();
    await tick(10_500);
    const id = events().find((e) => e.type === 'CANDIDATE_LEAVING')!.detail.instanceId as string;
    actor.receiveEphemeral(a.conn, eph('FOCUS_CHANGED', { hover: id, detail: null }));
    expect(events().at(-1)).toMatchObject({ type: 'CANDIDATE_STAYED', detail: { instanceId: id } });
    await tick(2_000); // 予告の時間（2秒）が過ぎても退場しない。最短間隔（3秒）より短い
    expect(actor.session.lowerSlots).toContain(id);
    // 取り消しの直後に、別の案へ予告が連発されない（予告の間隔も最短間隔を守る）
    const warnings = events().filter((e) => e.type === 'CANDIDATE_LEAVING').map((e) => e.seq);
    expect(warnings).toHaveLength(1);
  });

  it('詳細を開いている案は退場しない', async () => {
    const { actor, a, tick } = await setup();
    const watched = actor.session.lowerSlots[0]!;
    actor.receiveEphemeral(a.conn, eph('FOCUS_CHANGED', { hover: null, detail: watched }));
    await tick(60_000);
    expect(actor.session.lowerSlots).toContain(watched);
  });

  it('会話で取り上げられた案は残り、取り上げられていない案から退場する', async () => {
    const { actor, tick, events, judgeId } = await setup();
    // 最も早く登場した（＝何もしなければ最初に退場する）案を会話で取り上げる
    const talkedAbout = actor.session.lowerSlots[0]!;
    const name = CHARACTER_DESIGNS[actor.session.characters.get(talkedAbout)!.designId]!.readings[0]!;
    await tick(9_000);
    actor.receiveUtterance(judgeId, `${name}の案って面白そう`, 'live', null);
    const lastUtterance = events().filter((e) => e.type === 'JUDGE_UTTERANCE_RECEIVED').at(-1)!;
    expect(lastUtterance.detail.mentioned).toEqual([talkedAbout]);
    expect(lastUtterance.snapshot.characters[talkedAbout]!.mentions).toBe(1);
    await tick(12_000);
    const leftFirst = events().find((e) => e.type === 'CANDIDATE_LEAVING')!.detail.instanceId;
    expect(leftFirst).not.toBe(talkedAbout);
  });
});

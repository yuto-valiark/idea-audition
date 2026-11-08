import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage, type EventMessage } from '@idea-audition/protocol';
import { applyOps, emptyLedger, quorum, type Ledger } from '../src/domain/consensus.ts';
import { SessionActor } from '../src/application/session-actor.ts';
import { AuditionSession } from '../src/domain/session.ts';
import { GeminiGateway, renderContext } from '../src/infrastructure/gemini/gemini-gateway.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let n = 0;
const ctx = (judges: string[], now = 1000) => ({
  now,
  connectedJudges: judges.length,
  newId: () => `claim_${++n}`,
  validJudgeIds: new Set(judges),
});

describe('合意台帳（ドメイン）', () => {
  it('過半数：1人→1、2人→2、3人→2、4人→3', () => {
    expect([1, 2, 3, 4].map(quorum)).toEqual([1, 2, 2, 3]);
  });

  it('提案 → 過半数の賛成で合意 → 反対で提案中に戻る（時系列で賛否が変わる）', () => {
    const judges = ['a', 'b', 'c'];
    let l: Ledger = emptyLedger();
    let r = applyOps(l, [{ op: 'add_claim', text: '実現コストは低く', judgeId: 'a', stance: 'support', seq: 1 }], ctx(judges));
    l = r.ledger;
    expect(l.claims[0]).toMatchObject({ label: 'C1', status: 'proposed' });
    expect(l.version).toBe(1);

    r = applyOps(l, [{ op: 'set_stance', label: 'C1', judgeId: 'b', stance: 'support', seq: 2 }], ctx(judges, 2000));
    l = r.ledger;
    expect(l.claims[0]!.status).toBe('agreed');
    expect(r.statusChanges).toEqual([{ label: 'C1', text: '実現コストは低く', from: 'proposed', to: 'agreed' }]);

    // b が意見を変える：最新の賛否だけが数えられ、履歴は残る
    r = applyOps(l, [{ op: 'set_stance', label: 'C1', judgeId: 'b', stance: 'oppose', seq: 3 }], ctx(judges, 3000));
    l = r.ledger;
    expect(l.claims[0]!.status).toBe('proposed');
    expect(l.claims[0]!.history.map((h) => `${h.judgeId}:${h.stance}`)).toEqual(['a:support', 'b:support', 'b:oppose']);
    expect(l.version).toBe(3);
  });

  it('ピン留めは賛否に関わらず合意。置き換えられた論点は superseded', () => {
    const judges = ['a', 'b', 'c', 'd'];
    let l = applyOps(
      emptyLedger(),
      [
        { op: 'add_claim', text: '夜も営業', judgeId: 'a', stance: 'support', seq: 1 },
        { op: 'add_claim', text: '昼だけ営業', judgeId: 'b', stance: 'support', seq: 2 },
      ],
      ctx(judges),
    ).ledger;
    expect(l.version).toBe(1); // 1回の適用で版は1つだけ上がる
    l = applyOps(l, [{ op: 'pin', label: 'C2', judgeId: 'c' }], ctx(judges)).ledger;
    expect(l.claims[1]!.status).toBe('agreed');
    l = applyOps(l, [{ op: 'supersede', label: 'C1', byLabel: 'C2' }], ctx(judges)).ledger;
    expect(l.claims[0]!.status).toBe('superseded');
  });

  it('知らない論点・知らない審査員・重複した論点への操作は捨てる（版も上がらない）', () => {
    const l = applyOps(emptyLedger(), [{ op: 'add_claim', text: '安く', judgeId: 'a', stance: 'support', seq: 1 }], ctx(['a'])).ledger;
    const r = applyOps(
      l,
      [
        { op: 'set_stance', label: 'C9', judgeId: 'a', stance: 'oppose', seq: 2 },
        { op: 'set_stance', label: 'C1', judgeId: 'zzz', stance: 'oppose', seq: 2 },
        { op: 'add_claim', text: '安く', judgeId: 'a', stance: 'support', seq: 3 },
      ],
      ctx(['a']),
    );
    expect(r.applied).toEqual([]);
    expect(r.ledger.version).toBe(l.version);
  });

  it('台帳・発言・行動はセッションの保存と復元で残る', () => {
    const s = new AuditionSession('s', { ids: seqIds(), clock: fakeClock() });
    const j = s.join();
    if (!j.ok || !j.value.judgeId) throw new Error();
    s.start('テーマ', 'solo');
    s.recordUtterance({ seq: 5, judgeId: j.value.judgeId, text: '安くしたい', source: 'text', targetInstanceId: null, intent: 'comment', at: 1 });
    s.applyLedgerOps([{ op: 'add_claim', text: '安く', judgeId: j.value.judgeId, stance: 'support', seq: 5 }], 5);
    const r = AuditionSession.fromState('s', JSON.parse(JSON.stringify(s.toState())), { ids: seqIds(), clock: fakeClock() });
    expect(r.ledger.claims[0]).toMatchObject({ label: 'C1', text: '安く', status: 'agreed' });
    expect(r.utterances).toHaveLength(1);
    expect(r.ledgerCursor).toBe(5);
  });
});

describe('合意台帳とアクター', () => {
  let cid = 0;
  const cmd = (type: CommandMessage['type'], payload: object) =>
    ({ camp: CAMP_VERSION, kind: 'command', type, commandId: `k${++cid}`, sentAt: '', payload }) as CommandMessage;

  async function setup() {
    const { scheduler, advance } = manualScheduler();
    const ai = new StubAi();
    const actor = await SessionActor.open('c', {
      ai,
      store: new MemorySessionStore(),
      scheduler,
      clock: fakeClock(),
      ids: seqIds(),
      config: {
        stockTarget: 3,
        critiqueIntervalMs: 10,
        persistDelayMs: 10,
        rotation: null,
        consensus: { afterUtteranceMs: 1000, afterDecisionMs: 500, flushAfterUtterances: 3 },
      },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'c' });
    actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'solo' }));
    await advance(0);
    const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
    return { actor, ai, a, advance, events, judgeId: actor.session.judges[0]!.judgeId };
  }

  it('発言は少し待ってまとめて台帳に渡され、合意が全員に配られる', async () => {
    const { actor, ai, advance, events, judgeId } = await setup();
    actor.receiveUtterance(judgeId, '実現コストは低くしたい', 'text', null);
    actor.receiveUtterance(judgeId, '学生が主役がいいね', 'text', null);
    expect(ai.consensusCalls).toHaveLength(0);
    ai.nextConsensusOps = [{ op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: null }];
    await advance(1000);
    expect(ai.consensusCalls).toHaveLength(1);
    expect(ai.consensusCalls[0]!.utterances.map((u) => u.text)).toEqual(['実現コストは低くしたい', '学生が主役がいいね']);
    expect(ai.consensusCalls[0]!.utterances[0]!.judge).toBe('審査員 A'); // ID は渡さない
    const updated = events().find((e) => e.type === 'CONSENSUS_UPDATED')!;
    expect(updated.snapshot.consensus.claims[0]).toMatchObject({ label: 'C1', status: 'agreed' }); // ソロは1人で合意
    // 次の台帳更新では、反映済みの発言は渡さない
    actor.receiveUtterance(judgeId, 'ありだね', 'text', null);
    await advance(1000);
    expect(ai.consensusCalls[1]!.utterances.map((u) => u.text)).toEqual(['ありだね']);
  });

  it('合意が動いたら、古い合意で作った作り置きを捨てて合意つきで作り直す', async () => {
    const { actor, ai, advance, judgeId } = await setup();
    const staleBefore = actor.session.stock.length;
    expect(staleBefore).toBeGreaterThan(1);
    ai.nextConsensusOps = [{ op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: null }];
    actor.receiveUtterance(judgeId, '安くしたい', 'text', null);
    await advance(1000);
    const lastGenerate = ai.generateCalls.at(-1)!;
    expect(lastGenerate.context?.version).toBe(1);
    expect(lastGenerate.context?.agreed.map((c) => c.text)).toEqual(['実現コストは低く']);
    expect(actor.session.stock.filter((d) => (d.basedOnConsensus ?? 0) < 1).length).toBeLessThanOrEqual(1);
  });

  it('論点のピン留め・取り消しができる', async () => {
    const { actor, ai, a, advance, judgeId } = await setup();
    ai.nextConsensusOps = [{ op: 'add_claim', text: '夜営業', judge: null, stance: null, seq: null }];
    actor.receiveUtterance(judgeId, '夜営業はどう', 'text', null);
    await advance(1000);
    expect(actor.session.ledger.claims[0]!.status).toBe('proposed');
    actor.receiveCommand(a.conn, cmd('PIN_CLAIM', { label: 'C1' }));
    expect(actor.session.ledger.claims[0]!.status).toBe('agreed');
    actor.receiveCommand(a.conn, cmd('UNPIN_CLAIM', { label: 'C1' }));
    expect(actor.session.ledger.claims[0]!.pinned).toBe(false);
  });

  it('昇格・見送りも台帳の材料（行動）として渡される', async () => {
    const { actor, ai, a, advance } = await setup();
    actor.receiveCommand(a.conn, cmd('REJECT_CANDIDATE', { instanceId: actor.session.lowerSlots[0]! }));
    await advance(500);
    expect(ai.consensusCalls.at(-1)!.decisions.map((d) => d.kind)).toEqual(['rejected']);
  });
});

describe('Gemini：台帳の差分と文脈', () => {
  it('ラベルで返った操作を検証し、知らない審査員の賛否は捨てる', async () => {
    const client = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            ops: [
              { op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', label: '', byLabel: '', seq: 12 },
              { op: 'set_stance', text: '', judge: '審査員 Z', stance: 'oppose', label: 'C1', byLabel: '', seq: 0 },
              { op: 'set_stance', text: '', judge: '審査員 B', stance: 'oppose', label: 'C1', byLabel: '', seq: 13 },
            ],
          }),
        }),
      },
    };
    const g = new GeminiGateway(client, {
      fast: { model: 'm', thinkingLevel: 'MINIMAL', timeoutMs: 1000 },
      refine: { model: 'm', thinkingLevel: 'LOW', timeoutMs: 1000 },
    });
    const ops = await g.updateConsensus({
      theme: 't', nextClaimNumber: 2, judges: ['審査員 A', '審査員 B'],
      claims: [{ label: 'C1', text: '夜営業', status: 'proposed', stances: [] }],
      utterances: [], decisions: [],
    });
    expect(ops).toEqual([
      { op: 'add_claim', text: '実現コストは低く', judge: '審査員 A', stance: 'support', seq: 12 },
      { op: 'set_stance', label: 'C1', judge: '審査員 B', stance: 'oppose', seq: 13 },
    ]);
  });

  it('同じ版の文脈は同じ文字列になる（プロンプト前半のキャッシュが効くように）', () => {
    const ctx = { version: 3, agreed: [{ label: 'C1', text: '安く', supporters: ['審査員 A'] }], proposed: [], rejected: [], favoredIdeas: [], rejectedIdeas: [], recentRemarks: [{ judge: 'A', text: 'x' }] };
    const a = renderContext('学食', ctx);
    const b = renderContext('学食', { ...ctx, recentRemarks: [{ judge: 'B', text: 'y' }] });
    expect(a).toBe(b); // 直近の発言は L1 に含めない
    expect(a).toContain('合意台帳 v3');
  });
});

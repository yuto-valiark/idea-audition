import { describe, expect, it } from 'vitest';
import { HIP_VERSION, type CommandMessage, type EventMessage, type ServerMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
function cmd<T extends CommandMessage['type']>(type: T, payload: Extract<CommandMessage, { type: T }>['payload']) {
  return { hip: HIP_VERSION, kind: 'command', type, commandId: `c${++cid}`, sentAt: '', payload } as CommandMessage;
}
const events = (msgs: ServerMessage[]) => msgs.filter((m): m is EventMessage => m.kind === 'event');
const results = (msgs: ServerMessage[]) => msgs.filter((m) => m.kind === 'result');

async function setup() {
  const { scheduler, advance } = manualScheduler();
  const ai = new StubAi();
  const actor = new SessionActor('demo', {
    ai,
    store: new MemorySessionStore(),
    scheduler,
    clock: fakeClock(),
    ids: seqIds(),
    config: { stockTarget: 3, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50 },
  });
  const a = fakeConnection('a');
  const b = fakeConnection('b');
  actor.attach(a.conn, { hip: HIP_VERSION, kind: 'hello', sessionId: 'demo' });
  actor.attach(b.conn, { hip: HIP_VERSION, kind: 'hello', sessionId: 'demo' });
  actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '大学の学食', mode: 'team' }));
  await advance(0);
  return { actor, ai, a, b, advance };
}

describe('SessionActor', () => {
  it('開始後、両方の接続に同じ下段5体が届く', async () => {
    const { a, b } = await setup();
    const lastA = events(a.received).at(-1)!.snapshot;
    const lastB = events(b.received).at(-1)!.snapshot;
    expect(lastA.lowerSlots.filter(Boolean)).toHaveLength(5);
    expect(lastA).toEqual(lastB);
  });

  it('2人が同じキャラを同時に昇格しようとしても、確定は1回だけ（AC-31）', async () => {
    const { actor, a, b } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    actor.receiveCommand(b.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    const ra = results(a.received).at(-1)!;
    const rb = results(b.received).at(-1)!;
    expect(ra).toMatchObject({ ok: true });
    expect(rb).toMatchObject({ ok: false, reason: 'NOT_IN_LOWER' });
    const confirmed = events(a.received).filter((e) => e.type === 'PROMOTION_CONFIRMED');
    expect(confirmed).toHaveLength(1);
  });

  it('同じ commandId の再送は再実行せず同じ結果を返す', async () => {
    const { actor, a } = await setup();
    const c = cmd('REQUEST_PROMOTION', { instanceId: actor.session.lowerSlots[0]! });
    actor.receiveCommand(a.conn, c);
    actor.receiveCommand(a.conn, c);
    const rs = results(a.received).filter((r) => r.kind === 'result' && r.commandId === c.commandId);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual(rs[1]);
    expect(actor.session.upper).toHaveLength(1);
  });

  it('昇格すると改良版が公開され、元の版も残る（AC-20, AC-23）', async () => {
    const { actor, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: target }));
    await advance(100);
    const published = events(a.received).filter((e) => e.type === 'FINALIST_VERSION_PUBLISHED');
    expect(published).toHaveLength(1);
    const snap = events(a.received).at(-1)!.snapshot;
    const idea = snap.ideas[snap.characters[target]!.ideaId]!;
    expect(idea.revisions.map((r) => r.version)).toEqual([1, 2]);
    expect(snap.upper[0]!.status).toBe('ready');
  });

  it('2体目の加入で相互批評が2ラウンド順に出て、その後に両方の改良版が出る（AC-27）', async () => {
    const { actor, a, ai, advance } = await setup();
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: actor.session.lowerSlots[0]! }));
    await advance(100);
    actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: actor.session.lowerSlots[0]! }));
    await advance(100);
    expect(ai.refineCalls.at(-1)).toMatchObject({ trigger: 'arrival', rounds: 2 });
    const types = () => events(a.received).map((e) => e.type);
    const countOf = (t: string) => types().filter((x) => x === t).length;
    expect(countOf('FINALIST_CRITIQUE_POSTED')).toBe(1);
    await advance(1000);
    expect(countOf('FINALIST_CRITIQUE_POSTED')).toBe(2);
    expect(countOf('FINALIST_VERSION_PUBLISHED')).toBe(1);
    await advance(1000);
    expect(countOf('FINALIST_VERSION_PUBLISHED')).toBe(3);
  });

  it('観覧者（5人目）の操作は SPECTATOR で拒否', async () => {
    const { actor } = await setup();
    const extra = ['c', 'd', 'e'].map((id) => fakeConnection(id));
    for (const x of extra) actor.attach(x.conn, { hip: HIP_VERSION, kind: 'hello', sessionId: 'demo' });
    const fifth = extra[2]!;
    const welcome = fifth.received.find((m) => m.kind === 'welcome');
    expect(welcome).toMatchObject({ judgeId: null });
    actor.receiveCommand(fifth.conn, cmd('NEXT_IDEA', {}));
    expect(results(fifth.received).at(-1)).toMatchObject({ ok: false, reason: 'SPECTATOR' });
  });

  it('質問は回答を返すだけで、案を変更しない（AC-14）', async () => {
    const { actor, a, advance } = await setup();
    const target = actor.session.lowerSlots[0]!;
    actor.receiveCommand(a.conn, cmd('ASK_CANDIDATE', { instanceId: target, text: '費用は？' }));
    await advance(10);
    const snap = events(a.received).at(-1)!.snapshot;
    expect(snap.answers.at(-1)).toMatchObject({ question: '費用は？', answer: '回答:費用は？' });
    expect(snap.ideas[snap.characters[target]!.ideaId]!.revisions).toHaveLength(1);
  });
});

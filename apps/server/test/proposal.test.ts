import { describe, expect, it } from 'vitest';
import { HIP_VERSION, type CommandMessage, type EventMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

let cid = 0;
const cmd = (type: CommandMessage['type'], payload: object) =>
  ({ hip: HIP_VERSION, kind: 'command', type, commandId: `p${++cid}`, sentAt: '', payload }) as CommandMessage;

async function crowned(failFirst = false, store = new MemorySessionStore()) {
  const { scheduler, advance } = manualScheduler();
  const ai = new StubAi();
  ai.failProposal = failFirst;
  const deps = {
    ai,
    store,
    scheduler,
    clock: fakeClock(),
    ids: seqIds(),
    config: { stockTarget: 3, critiqueIntervalMs: 10, persistDelayMs: 10, rotation: null, consensus: null },
  };
  const actor = await SessionActor.open('pr', deps);
  const a = fakeConnection('a');
  actor.attach(a.conn, { hip: HIP_VERSION, kind: 'hello', sessionId: 'pr' });
  actor.receiveCommand(a.conn, cmd('START_AUDITION', { theme: '学食', mode: 'solo' }));
  await advance(0);
  const id = actor.session.lowerSlots[0]!;
  actor.receiveCommand(a.conn, cmd('REQUEST_PROMOTION', { instanceId: id }));
  await advance(100);
  actor.receiveCommand(a.conn, cmd('SELECT_CHAMPION', { instanceId: id }));
  const events = () => a.received.filter((m): m is EventMessage => m.kind === 'event');
  return { actor, ai, a, advance, events, id, deps };
}

describe('企画書', () => {
  it('優勝が決まると自動で作り始め、できたら全員に配られる', async () => {
    const { ai, advance, events } = await crowned();
    const selected = events().find((e) => e.type === 'CHAMPION_SELECTED')!;
    expect(selected.snapshot.proposal).toMatchObject({ status: 'generating' });
    await advance(10);
    expect(ai.proposalCalls).toHaveLength(1);
    expect(ai.proposalCalls[0]!.champion.revisions.map((r) => r.version)).toEqual([1, 2]); // 改良の経緯を渡す
    const ready = events().find((e) => e.type === 'PROPOSAL_UPDATED')!;
    expect(ready.snapshot.proposal).toMatchObject({ status: 'ready', generatedBy: 'stub' });
    expect(ready.snapshot.proposal!.content!.title).toBe('改良版');
  });

  it('失敗したら failed になり、作り直しできる', async () => {
    const { ai, a, actor, advance, events } = await crowned(true);
    await advance(10);
    expect(events().at(-1)!.snapshot.proposal!.status).toBe('failed');
    ai.failProposal = false;
    actor.receiveCommand(a.conn, cmd('REGENERATE_PROPOSAL', {}));
    await advance(10);
    expect(events().at(-1)!.snapshot.proposal!.status).toBe('ready');
  });

  it('作成中に再起動しても、復元時に作り直す', async () => {
    const store = new MemorySessionStore();
    const first = await crowned(true, store);
    await first.actor.persist();
    // 失敗する前の「作成中」の状態で保存されたことにする
    const saved = store.sessions.get('pr')!;
    saved.state.proposal = { status: 'generating', content: null, generatedAt: null, generatedBy: null };
    const ai = new StubAi();
    const reopened = await SessionActor.open('pr', { ...first.deps, ai });
    await first.advance(10);
    expect(ai.proposalCalls).toHaveLength(1);
    expect(reopened.session.proposal!.status).toBe('ready');
  });
});

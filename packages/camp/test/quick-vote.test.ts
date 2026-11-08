/**
 * @camp-protocol/kit を IDEA AUDITION 以外のアプリ（examples/quick-vote）で使い、プロトコルの約束を確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CAMP_CLOSE, CAMP_VERSION } from '../src/core/index.ts';
import { CampClient, type WebSocketLike } from '../src/client/index.ts';
import { createCampServer } from '../src/server/index.ts';
import { pollRoom, type Summarize } from '../examples/quick-vote/room.ts';
import { quickVote } from '../examples/quick-vote/vocabulary.ts';

let release: (() => void) | null = null;
/** 締め切りのたびに呼ばれる「AI のまとめ」。テストから止めたり進めたりできる */
const summarize: Summarize = (q, tally) =>
  new Promise((r) => {
    release = () => r(`${q}:${tally.join('-')}`);
  });

let server: ReturnType<typeof createCampServer<typeof quickVote, unknown>>;
let url = '';
beforeAll(async () => {
  server = createCampServer(quickVote, { port: 0, room: pollRoom(summarize), helloTimeoutMs: 300 }) as never;
  url = `ws://127.0.0.1:${await server.port}/camp`;
});
afterAll(() => server.close());

type Client = CampClient<typeof quickVote> & { socket: () => WebSocket; snap: () => Snap | null; events: string[] };
type Snap = Parameters<NonNullable<Parameters<CampClient<typeof quickVote>['on']>[0]['onSnapshot']>>[0];

let roomNo = 0;
function join(room: string, participantId?: string): Promise<Client> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let snap: Snap | null = null;
    const events: string[] = [];
    const c = new CampClient(quickVote, {
      url,
      room,
      ...(participantId ? { participantId } : {}),
      createSocket: (u) => (ws = new WebSocket(u)) as unknown as WebSocketLike,
      maxBackoffMs: 50,
    }) as Client;
    c.socket = () => ws;
    c.snap = () => snap;
    c.events = events;
    c.on({
      onSnapshot: (s) => (snap = s),
      onEvent: (e) => events.push(`${e.seq}:${e.type}`),
      onWelcome: () => resolve(c),
    }).connect();
  });
}
const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function openRoom(n: number) {
  const room = `qv-${++roomNo}`;
  const clients: Client[] = [];
  for (let i = 0; i < n; i++) clients.push(await join(room));
  expect(await clients[0]!.send('OPEN_POLL', { question: '打ち上げ', options: ['焼肉', 'カレー', '寿司'] })).toEqual({ ok: true });
  await until(() => clients.every((c) => c.snap()?.status === 'open'));
  return { room, clients };
}

describe('@camp-protocol/kit × Quick Vote', () => {
  it('同時に投票しても、全員が同じ順番で同じ状態を受け取る', async () => {
    const { clients } = await openRoom(4);
    const results = await Promise.all(clients.map((c, i) => c.send('VOTE', { option: i % 3 })));
    expect(results.every((r) => r.ok)).toBe(true);
    await until(() => clients.every((c) => Object.keys(c.snap()!.votes).length === 4));
    const orders = clients.map((c) => c.events.join(','));
    expect(new Set(orders).size).toBe(1); // 4人とも同じ連番・同じ順番
    expect(new Set(clients.map((c) => JSON.stringify(c.snap())))).toHaveProperty('size', 1);
  });

  it('ルールに合わない操作は、状態を変えずに理由を返す', async () => {
    const { clients } = await openRoom(2);
    const [host, guest] = clients as [Client, Client];
    expect(await guest.send('VOTE', { option: 9 })).toEqual({ ok: false, reason: 'NO_SUCH_OPTION' });
    expect(await guest.send('VOTE', { option: 1 })).toEqual({ ok: true });
    expect(await guest.send('VOTE', { option: 0 })).toEqual({ ok: false, reason: 'ALREADY_VOTED' });
    expect(await guest.send('CLOSE_POLL', {})).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(host.snap()!.status).toBe('open');
  });

  it('同じ commandId の再送は1回しか実行しない', async () => {
    const { room, clients } = await openRoom(1);
    const raw = new WebSocket(url);
    const got: { kind: string; type?: string; commandId?: string }[] = [];
    raw.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => raw.on('open', r));
    raw.send(JSON.stringify({ camp: CAMP_VERSION, kind: 'hello', sessionId: room }));
    await until(() => got.some((m) => m.kind === 'welcome'));
    const vote = { camp: CAMP_VERSION, kind: 'command', type: 'VOTE', commandId: 'same', sentAt: '', payload: { option: 2 } };
    for (let i = 0; i < 3; i++) raw.send(JSON.stringify(vote));
    await until(() => got.filter((m) => m.kind === 'result').length === 3);
    const results = got.filter((m) => m.kind === 'result');
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(got.filter((m) => m.kind === 'event' && m.type === 'VOTED')).toHaveLength(1);
    expect(Object.keys(clients[0]!.snap()!.votes)).toHaveLength(1);
    raw.close();
  });

  it('切断しても自動で再接続し、同じ参加者として最新の状態に追いつく', async () => {
    const { clients } = await openRoom(2);
    const [host, guest] = clients as [Client, Client];
    const id = guest.id;
    guest.socket().terminate();
    await host.send('VOTE', { option: 0 }); // 切断中に起きた変化
    await until(() => guest.snap()?.votes[host.id!] === 0);
    expect(guest.id).toBe(id);
    expect(await guest.send('VOTE', { option: 1 })).toEqual({ ok: true });
  });

  it('遅い処理（AI のまとめ）は、作り直したあとに届いても新しい投票に混ざらない', async () => {
    const { clients } = await openRoom(1);
    const host = clients[0]!;
    await host.send('VOTE', { option: 0 });
    await host.send('CLOSE_POLL', {});
    const late = release!;
    await host.send('OPEN_POLL', { question: '次の質問', options: ['A', 'B'] }); // まとめを待たずに次へ
    late();
    await new Promise((r) => setTimeout(r, 50));
    expect(host.snap()!.question).toBe('次の質問');
    expect(host.snap()!.summary).toBeNull();
    // 次の締め切りのまとめは普通に届く
    await host.send('CLOSE_POLL', {});
    release!();
    await until(() => host.snap()!.summary === '次の質問:0-0');
  });

  it('定員を超えた人は観覧になり、操作は SPECTATOR で断られる', async () => {
    const { room } = await openRoom(5);
    const sixth = await join(room);
    expect(sixth.id).toBeNull();
    expect(await sixth.send('VOTE', { option: 0 })).toEqual({ ok: false, reason: 'SPECTATOR' });
  });

  it('Signal は返事なしで、1人1秒2件までに間引かれる', async () => {
    const { clients } = await openRoom(1);
    const host = clients[0]!;
    for (let i = 0; i < 10; i++) host.signal('HMM', {});
    await new Promise((r) => setTimeout(r, 100));
    expect(host.snap()!.hmm).toBe(2);
  });

  it('知らない Command は UNKNOWN_TYPE、違う版の hello は 4400 で切断', async () => {
    const raw = new WebSocket(url);
    const got: { kind: string; reason?: string; code?: string }[] = [];
    raw.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => raw.on('open', r));
    raw.send(JSON.stringify({ camp: CAMP_VERSION, kind: 'hello', sessionId: `qv-${++roomNo}` }));
    await until(() => got.some((m) => m.kind === 'welcome'));
    raw.send(JSON.stringify({ camp: CAMP_VERSION, kind: 'command', type: 'TELEPORT', commandId: 'x', sentAt: '', payload: {} }));
    await until(() => got.some((m) => m.kind === 'result'));
    expect(got.find((m) => m.kind === 'result')).toMatchObject({ ok: false, reason: 'UNKNOWN_TYPE' });
    raw.close();

    const old = new WebSocket(url);
    const closed = new Promise<number>((r) => old.on('close', (code) => r(code)));
    await new Promise((r) => old.on('open', r));
    old.send(JSON.stringify({ camp: '2', kind: 'hello', sessionId: 'x' }));
    expect(await closed).toBe(CAMP_CLOSE.UNSUPPORTED_VERSION);
  });

  it('close() 中に切れた部屋は片付けられ、プロセスを引き止めるタイマーを残さない', async () => {
    const own = createCampServer(quickVote, { port: 0, room: pollRoom(summarize) });
    const ownUrl = `ws://127.0.0.1:${await own.port}/camp`;
    const ws = new WebSocket(ownUrl);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ camp: CAMP_VERSION, kind: 'hello', sessionId: 'closing' }));
    await until(() => !!own.rooms.get('closing'));
    await own.close();
    await until(() => !own.rooms.get('closing'));
  });
});

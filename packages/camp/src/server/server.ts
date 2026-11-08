import { createServer } from 'node:http';
import type { AnyVocabulary } from '../core/vocabulary.ts';
import { CampRoom, type RoomDefinition } from './room.ts';
import { createCampTransport, type RoomRegistry } from './transport.ts';
import { randomRoomId } from './room-id.ts';
import { rejectUpgrade } from './upgrade.ts';

/**
 * いちばん短い始め方。http サーバー・/camp の WebSocket・部屋の管理をまとめて立てる。
 *
 *   const server = createCampServer(quiz, { port: 8787, room: { initialState, commands: { ANSWER(room, p, ctx) { … } } } });
 *   await server.port;
 *
 * 既定では、知らない部屋 ID で入ってきたらその部屋を作る（試すのに便利）。
 * 「作った部屋のリンクを知っている人だけが入れる」ようにするには autoCreateRooms: false にして、
 * server.createRoom() で部屋を作り、返った ID をリンクにして配る。
 */
export function createCampServer<V extends AnyVocabulary, S>(
  vocabulary: V,
  opts: {
    room: RoomDefinition<V, S>;
    /** 0 なら空いているポート */
    port?: number;
    path?: string;
    /** 知らない部屋 ID で入ってきたら部屋を作るか（既定 true）。false なら createRoom() した部屋にだけ入れる */
    autoCreateRooms?: boolean;
    /** 誰もいなくなった部屋を消すまでの時間 */
    idleReleaseMs?: number;
    helloTimeoutMs?: number;
    log?: (m: string) => void;
  },
) {
  const rooms = new Map<string, { room: CampRoom<V, S>; timer?: ReturnType<typeof setTimeout> }>();
  let closing = false;
  const registry: RoomRegistry<V> = {
    async get(id) {
      let entry = rooms.get(id);
      if (!entry) {
        if (opts.autoCreateRooms === false) return null;
        entry = { room: new CampRoom(id, opts.room) };
        rooms.set(id, entry);
      }
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      return entry.room;
    },
    release(id) {
      const entry = rooms.get(id);
      if (!entry) return;
      if (closing) return void rooms.delete(id);
      entry.timer = setTimeout(() => rooms.delete(id), opts.idleReleaseMs ?? 10 * 60_000);
      // 空き部屋の片付けのためだけに、プロセスの終了を引き止めない
      entry.timer.unref?.();
    },
  };
  const transport = createCampTransport({
    vocabulary,
    rooms: registry,
    ...(opts.helloTimeoutMs ? { helloTimeoutMs: opts.helloTimeoutMs } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });
  const path = opts.path ?? '/camp';
  const http = createServer((req, res) => {
    if (req.url === '/health') return void res.writeHead(200).end('ok');
    res.writeHead(404).end();
  });
  http.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== path) return rejectUpgrade(socket);
    transport.handleUpgrade(req, socket, head);
  });
  const port = new Promise<number>((resolve) =>
    http.listen(opts.port ?? 8787, () => {
      const a = http.address();
      resolve(typeof a === 'object' && a ? a.port : (opts.port ?? 8787));
    }),
  );
  return {
    port,
    rooms: {
      get: (id: string) => rooms.get(id)?.room,
    },
    /** 部屋を作って ID を返す（ID を省くと推測されにくい ID を振る）。誰も入らなければ idleReleaseMs で消える */
    createRoom(id: string = randomRoomId()) {
      if (!rooms.has(id)) rooms.set(id, { room: new CampRoom(id, opts.room) });
      registry.release(id);
      return id;
    },
    async close() {
      closing = true;
      for (const e of rooms.values()) if (e.timer) clearTimeout(e.timer);
      await transport.close();
      await new Promise<void>((r) => http.close(() => r()));
      rooms.clear();
    },
  };
}

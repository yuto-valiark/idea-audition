import { createServer } from 'node:http';
import type { AnyVocabulary } from '../core/vocabulary.ts';
import { CampRoom, type RoomDefinition } from './room.ts';
import { createCampTransport, type RoomRegistry } from './transport.ts';

/**
 * いちばん短い始め方。http サーバー・/camp の WebSocket・部屋の管理をまとめて立てる。
 *
 *   const server = createCampServer(quiz, { port: 8787, room: { initialState, commands: { ANSWER(room, p, ctx) { … } } } });
 *   await server.port;
 */
export function createCampServer<V extends AnyVocabulary, S>(
  vocabulary: V,
  opts: {
    room: RoomDefinition<V, S>;
    /** 0 なら空いているポート */
    port?: number;
    path?: string;
    accessCode?: string | null;
    /** 誰もいなくなった部屋を消すまでの時間 */
    idleReleaseMs?: number;
    helloTimeoutMs?: number;
    log?: (m: string) => void;
  },
) {
  const rooms = new Map<string, { room: CampRoom<V, S>; timer?: ReturnType<typeof setTimeout> }>();
  const registry: RoomRegistry<V> = {
    async get(id) {
      let entry = rooms.get(id);
      if (!entry) {
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
      entry.timer = setTimeout(() => rooms.delete(id), opts.idleReleaseMs ?? 10 * 60_000);
    },
  };
  const transport = createCampTransport({
    vocabulary,
    rooms: registry,
    accessCode: opts.accessCode ?? null,
    ...(opts.helloTimeoutMs ? { helloTimeoutMs: opts.helloTimeoutMs } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });
  const path = opts.path ?? '/camp';
  const http = createServer((req, res) => {
    if (req.url === '/health') return void res.writeHead(200).end('ok');
    res.writeHead(404).end();
  });
  http.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== path) return void socket.destroy();
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
    async close() {
      for (const e of rooms.values()) if (e.timer) clearTimeout(e.timer);
      await transport.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

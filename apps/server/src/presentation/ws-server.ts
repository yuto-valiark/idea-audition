import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { WebSocketServer } from 'ws';
import { createCampTransport, type RoomRegistry } from '@camp-protocol/kit/server';
import { vocabulary } from '@idea-audition/protocol';
import type { SessionActor } from '../application/session-actor.ts';
import { createStaticHandler } from './static-files.ts';

/** 部屋（セッション）の管理。SessionActor が CAMP の RoomEndpoint を実装する。作られていない部屋は null */
export interface ActorRegistry extends RoomRegistry<typeof vocabulary> {
  get(sessionId: string): Promise<SessionActor | null>;
}

/** 部屋を作る窓口（POST /api/rooms）。clientKey は送り手の目印（回数の上限に使う） */
export type CreateRoom = (clientKey: string) => Promise<{ ok: true; roomId: string } | { ok: false; status: number; reason: string }>;

/**
 * http サーバー。/camp は CAMP（@camp-protocol/kit の transport が形・版・部屋の有無・時間切れ・送りすぎを受け持つ）、
 * /voice は音声、POST /api/rooms は部屋づくり、それ以外は画面のファイルと /health。
 */
export function startServer(opts: {
  port: number;
  registry: ActorRegistry;
  voice: WebSocketServer | null;
  /** 部屋を作る（null なら POST /api/rooms は使えない） */
  createRoom: CreateRoom | null;
  /** 本番で画面のファイルを配るディレクトリ（null なら配らない。開発時は Vite が配る） */
  staticDir: string | null;
  /** テスト用に上書きできる */
  helloTimeoutMs?: number;
  log: (m: string) => void;
}) {
  const serveStatic = opts.staticDir ? createStaticHandler(opts.staticDir) : null;
  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      // Cloud Run は z で終わるパス（/healthz など）を予約しているため /health にする
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.url === '/api/rooms' && req.method === 'POST' && opts.createRoom) {
      const r = await opts.createRoom(clientKey(req)).catch((e) => {
        opts.log(`room create failed: ${String(e)}`);
        return { ok: false as const, status: 500, reason: 'CREATE_FAILED' };
      });
      res
        .writeHead(r.ok ? 201 : r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(r.ok ? { roomId: r.roomId } : { error: r.reason }));
      return;
    }
    if (serveStatic && (await serveStatic(req, res))) return;
    res.writeHead(404).end();
  });
  const camp = createCampTransport({
    vocabulary,
    rooms: opts.registry,
    ...(opts.helloTimeoutMs ? { helloTimeoutMs: opts.helloTimeoutMs } : {}),
    log: opts.log,
  });
  // パスで振り分ける：/camp は操作、/voice は音声（別経路、仕様書 9.2）
  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/camp') return camp.handleUpgrade(req, socket, head);
    const voice = opts.voice;
    if (path === '/voice' && voice) return voice.handleUpgrade(req, socket, head, (ws) => voice.emit('connection', ws, req));
    socket.destroy();
  });
  // port: 0 なら空いているポートを使う（テスト用）。実際のポートを返す
  const port = new Promise<number>((resolve) =>
    http.listen(opts.port, () => {
      const address = http.address();
      const actual = typeof address === 'object' && address ? address.port : opts.port;
      opts.log(`CAMP server listening on :${actual} (ws path /camp)`);
      resolve(actual);
    }),
  );
  return {
    port,
    close: async () => {
      await camp.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

/** 送り手の目印。Cloud Run では x-forwarded-for の先頭が利用者の IP */
function clientKey(req: IncomingMessage) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

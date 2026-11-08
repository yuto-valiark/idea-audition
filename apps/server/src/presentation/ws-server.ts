import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { WebSocketServer } from 'ws';
import { createCampTransport, type RoomRegistry } from '@camp-protocol/kit/server';
import { vocabulary } from '@idea-audition/protocol';
import type { SessionActor } from '../application/session-actor.ts';
import { createStaticHandler } from './static-files.ts';

/** 部屋（セッション）の管理。SessionActor が CAMP の RoomEndpoint を実装する */
export interface ActorRegistry extends RoomRegistry<typeof vocabulary> {
  get(sessionId: string): Promise<SessionActor>;
}

/**
 * http サーバー。/camp は CAMP（@camp-protocol/kit の transport が形・版・合言葉・時間切れ・送りすぎを受け持つ）、
 * /voice は音声、それ以外は画面のファイルと /health。
 */
export function startServer(opts: {
  port: number;
  registry: ActorRegistry;
  voice: WebSocketServer | null;
  /** 公開環境の合言葉（null なら不要） */
  accessCode: string | null;
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
    if (serveStatic && (await serveStatic(req, res))) return;
    res.writeHead(404).end();
  });
  const camp = createCampTransport({
    vocabulary,
    rooms: opts.registry,
    accessCode: opts.accessCode,
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

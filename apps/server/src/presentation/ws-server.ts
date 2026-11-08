import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ClientMessage,
  CommandPayloads,
  HIP_CLOSE,
  HIP_VERSION,
  SUPPORTED_HIP_VERSIONS,
  type ProtocolErrorCode,
  type ServerMessage,
} from '@idea-audition/protocol';
import type { Connection, SessionActor } from '../application/session-actor.ts';
import { checkAccess } from './access.ts';
import { createStaticHandler } from './static-files.ts';

const HEARTBEAT_MS = 25_000;
/** 接続してからこの時間内に hello が来なければ閉じる（§11 4408） */
const HELLO_TIMEOUT_MS = 10_000;
/** 1接続あたりの受信上限（カーソルは 20Hz 程度。超えたら 4429 で閉じる） */
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 120;

function describe(data: unknown): { kind?: unknown; type?: unknown; hip?: unknown; commandId?: unknown } {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

export interface ActorRegistry {
  /** 初回は保存先から復元するため非同期 */
  get(sessionId: string): Promise<SessionActor>;
  release(sessionId: string): void;
}

/**
 * HIP の WebSocket 終端。メッセージの検証だけを行い、判定はアクターに渡す。
 * パス：/hip（開発時は Vite がプロキシする）
 */
export function startServer(opts: {
  port: number;
  /** テスト用に上書きできる */
  helloTimeoutMs?: number;
  registry: ActorRegistry;
  voice: WebSocketServer | null;
  /** 公開環境の合言葉（null なら不要） */
  accessCode: string | null;
  /** 本番で画面のファイルを配るディレクトリ（null なら配らない。開発時は Vite が配る） */
  staticDir: string | null;
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
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  // パスで振り分ける：/hip は操作、/voice は音声（別経路、仕様書 9.2）
  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    const target = path === '/hip' ? wss : path === '/voice' ? opts.voice : null;
    if (!target) {
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  });
  let nextId = 0;

  wss.on('connection', (ws: WebSocket) => {
    const conn: Connection = {
      id: `conn_${++nextId}`,
      send: (m: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
    };
    // hello 以降のメッセージは、アクターの準備（復元）が終わってから順番どおりに処理する
    let actorReady: Promise<SessionActor | null> | null = null;
    let sessionId: string | null = null;
    let alive = true;
    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);

    const protocolError = (code: ProtocolErrorCode, detail: string) =>
      conn.send({ hip: HIP_VERSION, kind: 'protocol_error', code, detail, supported: [...SUPPORTED_HIP_VERSIONS] });
    const helloTimer = setTimeout(() => {
      if (actorReady) return;
      ws.close(HIP_CLOSE.HELLO_TIMEOUT, 'hello timeout');
    }, opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    let windowStart = Date.now();
    let received = 0;

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - windowStart >= RATE_WINDOW_MS) {
        windowStart = now;
        received = 0;
      }
      if (++received > RATE_LIMIT) {
        if (received === RATE_LIMIT + 1) {
          protocolError('RATE_LIMITED', `more than ${RATE_LIMIT} messages per second`);
          ws.close(HIP_CLOSE.RATE_LIMITED, 'rate limited');
        }
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        protocolError('MALFORMED', 'not JSON');
        return;
      }
      const head = describe(data);
      // バージョンは形の検証より先に見る（違う版の形はこちらの Zod では読めない）
      if (head.hip !== HIP_VERSION) {
        protocolError('UNSUPPORTED_VERSION', `hip ${JSON.stringify(head.hip ?? null)} is not supported`);
        if (head.kind === 'hello' || !actorReady) ws.close(HIP_CLOSE.UNSUPPORTED_VERSION, 'unsupported version');
        return;
      }
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
        if (head.kind === 'command' && typeof head.commandId === 'string') {
          // 知らない type は前方互換のため UNKNOWN_TYPE、知っている type の形違いは INVALID_PAYLOAD
          const known = typeof head.type === 'string' && head.type in CommandPayloads;
          conn.send({ hip: HIP_VERSION, kind: 'result', commandId: head.commandId, ok: false, reason: known ? 'INVALID_PAYLOAD' : 'UNKNOWN_TYPE' });
        } else if (head.kind === 'ephemeral' || head.kind === 'signal' || head.kind === 'hello' || head.kind === 'command') {
          protocolError('MALFORMED', `invalid ${String(head.kind)} message`);
        } else {
          protocolError('UNKNOWN_TYPE', `unknown kind ${JSON.stringify(head.kind ?? null)}`);
        }
        return;
      }
      const msg = parsed.data;
      if (msg.kind === 'hello') {
        if (actorReady) return;
        clearTimeout(helloTimer);
        const access = checkAccess(opts.accessCode, msg.accessCode);
        if (access !== 'ok') {
          conn.send({ hip: HIP_VERSION, kind: 'access_denied', reason: access });
          ws.close(HIP_CLOSE.ACCESS_DENIED, 'access denied');
          return;
        }
        sessionId = msg.sessionId;
        actorReady = opts.registry.get(sessionId).then(
          (actor) => {
            if (closed) return null;
            actor.attach(conn, msg);
            return actor;
          },
          (e) => {
            opts.log(`session open failed: ${String(e)}`);
            ws.close(1011, 'session unavailable');
            return null;
          },
        );
        return;
      }
      if (!actorReady) {
        if (msg.kind === 'command') {
          conn.send({ hip: HIP_VERSION, kind: 'result', commandId: msg.commandId, ok: false, reason: 'NOT_AUTHORIZED' });
        }
        protocolError('NOT_JOINED', 'send hello first');
        return;
      }
      void actorReady.then((actor) => {
        if (!actor) return;
        if (msg.kind === 'command') actor.receiveCommand(conn, msg);
        else if (msg.kind === 'signal') actor.receiveSignal(conn, msg);
        else actor.receiveEphemeral(conn, msg);
      });
    });

    let closed = false;
    ws.on('close', () => {
      closed = true;
      clearInterval(beat);
      clearTimeout(helloTimer);
      void actorReady?.then((actor) => {
        if (!actor || !sessionId) return;
        actor.detach(conn);
        if (actor.connectionCount === 0) opts.registry.release(sessionId);
      });
    });
  });

  // port: 0 なら空いているポートを使う（テスト用）。実際のポートを返す
  const port = new Promise<number>((resolve) =>
    http.listen(opts.port, () => {
      const address = http.address();
      const actual = typeof address === 'object' && address ? address.port : opts.port;
      opts.log(`HIP server listening on :${actual} (ws path /hip)`);
      resolve(actual);
    }),
  );
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => r()));
      }),
  };
}

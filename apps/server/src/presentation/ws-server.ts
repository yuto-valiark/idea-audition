import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ClientMessage,
  HIP_VERSION,
  type ServerMessage,
} from '@idea-audition/protocol';
import type { Connection, SessionActor } from '../application/session-actor.ts';

const HEARTBEAT_MS = 25_000;

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
  registry: ActorRegistry;
  voice: WebSocketServer | null;
  log: (m: string) => void;
}) {
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
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

    ws.on('message', (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
        const commandId = (data as { commandId?: unknown })?.commandId;
        if (typeof commandId === 'string') {
          conn.send({ hip: HIP_VERSION, kind: 'result', commandId, ok: false, reason: 'INVALID_PAYLOAD' });
        }
        return;
      }
      const msg = parsed.data;
      if (msg.kind === 'hello') {
        if (actorReady) return;
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
      if (!actorReady) return;
      void actorReady.then((actor) => {
        if (!actor) return;
        if (msg.kind === 'command') actor.receiveCommand(conn, msg);
        else actor.receiveEphemeral(conn, msg);
      });
    });

    let closed = false;
    ws.on('close', () => {
      closed = true;
      clearInterval(beat);
      void actorReady?.then((actor) => {
        if (!actor || !sessionId) return;
        actor.detach(conn);
        if (actor.connectionCount === 0) opts.registry.release(sessionId);
      });
    });
  });

  http.listen(opts.port, () => opts.log(`HIP server listening on :${opts.port} (ws path /hip)`));
  return { close: () => new Promise<void>((r) => wss.close(() => http.close(() => r()))) };
}

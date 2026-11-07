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
  get(sessionId: string): SessionActor;
  release(sessionId: string): void;
}

/**
 * HIP の WebSocket 終端。メッセージの検証だけを行い、判定はアクターに渡す。
 * パス：/hip（開発時は Vite がプロキシする）
 */
export function startServer(opts: { port: number; registry: ActorRegistry; log: (m: string) => void }) {
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, path: '/hip', maxPayload: 64 * 1024 });
  let nextId = 0;

  wss.on('connection', (ws: WebSocket) => {
    const conn: Connection = {
      id: `conn_${++nextId}`,
      send: (m: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
    };
    let actor: SessionActor | null = null;
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
        if (actor) return;
        sessionId = msg.sessionId;
        actor = opts.registry.get(sessionId);
        actor.attach(conn, msg);
        return;
      }
      if (!actor) return;
      if (msg.kind === 'command') actor.receiveCommand(conn, msg);
      else actor.receiveEphemeral(conn, msg);
    });

    ws.on('close', () => {
      clearInterval(beat);
      if (actor && sessionId) {
        actor.detach(conn);
        if (actor.connectionCount === 0) opts.registry.release(sessionId);
      }
    });
  });

  http.listen(opts.port, () => opts.log(`HIP server listening on :${opts.port} (ws path /hip)`));
  return { close: () => new Promise<void>((r) => wss.close(() => http.close(() => r()))) };
}

import {
  HIP_VERSION,
  ServerMessage,
  type CommandMessage,
  type CommandPayload,
  type CommandType,
  type EphemeralMessage,
  type EphemeralPayloads,
  type EphemeralType,
  type EventMessage,
  type RejectReason,
  type WelcomeMessage,
} from '@idea-audition/protocol';
import type { z } from 'zod';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting';
export type CommandOutcome = { ok: true } | { ok: false; reason: RejectReason | 'TIMEOUT' };

interface Handlers {
  onWelcome(m: WelcomeMessage): void;
  onEvent(m: EventMessage): void;
  onEphemeral(m: EphemeralMessage): void;
  onState(s: ConnectionState): void;
}

const COMMAND_TIMEOUT_MS = 8000;

function hipUrl() {
  const configured = import.meta.env.VITE_HIP_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/hip`;
}

function uuid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * HIP v1 クライアント。
 * - 切断したら指数バックオフで再接続し、judgeId と lastSeq を付けて hello を送る
 * - 未確定の Command は同じ commandId で再送する（サーバーが重複を排除する）
 */
export class HipClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private judgeId: string | undefined;
  private lastSeq: number | undefined;
  private pending = new Map<
    string,
    { message: CommandMessage; resolve: (o: CommandOutcome) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly sessionId: string,
    private readonly handlers: Handlers,
    initialJudgeId?: string,
  ) {
    this.judgeId = initialJudgeId;
  }

  connect() {
    this.closed = false;
    this.handlers.onState(this.retry === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(hipUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(
        JSON.stringify({
          hip: HIP_VERSION,
          kind: 'hello',
          sessionId: this.sessionId,
          judgeId: this.judgeId,
          lastSeq: this.lastSeq,
        }),
      );
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      this.handlers.onState('reconnecting');
      const delay = Math.min(5000, 400 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  send<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandOutcome> {
    const message = {
      hip: HIP_VERSION,
      kind: 'command',
      type,
      commandId: uuid(),
      sentAt: new Date().toISOString(),
      payload,
    } as CommandMessage;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.commandId);
        resolve({ ok: false, reason: 'TIMEOUT' });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(message.commandId, { message, resolve, timer });
      this.raw(message);
    });
  }

  sendEphemeral<T extends EphemeralType>(
    type: T,
    payload: z.infer<(typeof EphemeralPayloads)[T]>,
  ) {
    this.raw({ hip: HIP_VERSION, kind: 'ephemeral', type, payload });
  }

  private raw(message: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private receive(data: unknown) {
    let json: unknown;
    try {
      json = JSON.parse(String(data));
    } catch {
      return;
    }
    const parsed = ServerMessage.safeParse(json);
    if (!parsed.success) {
      console.warn('[hip] invalid server message', parsed.error.issues);
      return;
    }
    const m = parsed.data;
    switch (m.kind) {
      case 'welcome':
        this.judgeId = m.judgeId ?? this.judgeId;
        this.lastSeq = m.snapshot.seq;
        this.handlers.onWelcome(m);
        this.handlers.onState('open');
        for (const p of this.pending.values()) this.raw(p.message); // 未確定コマンドを再送
        break;
      case 'event':
        if (this.lastSeq !== undefined && m.seq <= this.lastSeq) return; // 重複・古いイベントを捨てる
        this.lastSeq = m.seq;
        this.handlers.onEvent(m);
        break;
      case 'result': {
        const p = this.pending.get(m.commandId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.commandId);
        p.resolve(m.ok ? { ok: true } : { ok: false, reason: m.reason ?? 'INVALID_PAYLOAD' });
        break;
      }
      case 'ephemeral':
        this.handlers.onEphemeral(m);
        break;
    }
  }
}

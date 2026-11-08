import { z } from 'zod';
import { AiMode, SessionMode, SessionSnapshot } from './model.ts';
import { RejectReason } from './reasons.ts';

export const HIP_VERSION = '1';
/** このサーバー・クライアントが話せる HIP のメジャー版 */
export const SUPPORTED_HIP_VERSIONS = [HIP_VERSION] as const;

/** WebSocket の終了コード（docs/protocol/hip-v1.md §11） */
export const HIP_CLOSE = {
  UNSUPPORTED_VERSION: 4400,
  ACCESS_DENIED: 4401,
  HELLO_TIMEOUT: 4408,
  RATE_LIMITED: 4429,
} as const;

const text = z.string().trim().min(1).max(400);
const id = z.string().min(1).max(80);

/* ------------------------------------------------------------------ */
/* Command: Client → Server（commandId で重複排除）                      */
/* ------------------------------------------------------------------ */

export const CommandPayloads = {
  START_AUDITION: z.object({ theme: text, mode: SessionMode, aiMode: AiMode.optional() }),
  /** AI のモードを切り替える（ホストのみ。途中でも可） */
  SET_AI_MODE: z.object({ mode: AiMode }),
  REQUEST_PROMOTION: z.object({ instanceId: id }),
  NEXT_IDEA: z.object({ instanceId: id.optional() }),
  /** 審査員の「見送り」：この案はないと判断して、すぐ次のキャラと交代させる */
  REJECT_CANDIDATE: z.object({ instanceId: id }),
  /** 合意台帳の論点を人が「これで決まり」と確定する／取り消す（ADR-0007） */
  PIN_CLAIM: z.object({ label: z.string().regex(/^C\d+$/) }),
  UNPIN_CLAIM: z.object({ label: z.string().regex(/^C\d+$/) }),
  ASK_CANDIDATE: z.object({ instanceId: id, text }),
  REQUEST_REFINEMENT: z.object({ instanceId: id, text }),
  SUBMIT_UTTERANCE: z.object({
    text,
    source: z.enum(['live', 'text']),
    targetInstanceId: id.optional(),
    /** 合意メモの論点への返答（例：C3 に対して「賛成」） */
    replyToClaim: z.string().regex(/^C\d+$/).optional(),
  }),
  START_CHAMPION_VOTE: z.object({}),
  CAST_VOTE: z.object({ instanceId: id }),
  CLOSE_VOTE: z.object({}),
  RESOLVE_TIE: z.object({ instanceId: id }),
  SELECT_CHAMPION: z.object({ instanceId: id }),
  RESET_SESSION: z.object({}),
  /** 企画書の作成に失敗したときの作り直し */
  REGENERATE_PROPOSAL: z.object({}),
} as const;
export type CommandType = keyof typeof CommandPayloads;
export type CommandPayload<T extends CommandType> = z.infer<(typeof CommandPayloads)[T]>;

const commandEnvelope = <T extends CommandType>(type: T) =>
  z.object({
    hip: z.literal(HIP_VERSION),
    kind: z.literal('command'),
    type: z.literal(type),
    commandId: id,
    sentAt: z.string(),
    /** 画面で見ていた対象の版（違えば STALE_VERSION。§7.2） */
    expected: z.object({ rev: id }).optional(),
    payload: CommandPayloads[type],
  });

export const CommandMessage = z.discriminatedUnion('type', [
  commandEnvelope('START_AUDITION'),
  commandEnvelope('SET_AI_MODE'),
  commandEnvelope('REQUEST_PROMOTION'),
  commandEnvelope('NEXT_IDEA'),
  commandEnvelope('REJECT_CANDIDATE'),
  commandEnvelope('PIN_CLAIM'),
  commandEnvelope('UNPIN_CLAIM'),
  commandEnvelope('ASK_CANDIDATE'),
  commandEnvelope('REQUEST_REFINEMENT'),
  commandEnvelope('SUBMIT_UTTERANCE'),
  commandEnvelope('START_CHAMPION_VOTE'),
  commandEnvelope('CAST_VOTE'),
  commandEnvelope('CLOSE_VOTE'),
  commandEnvelope('RESOLVE_TIE'),
  commandEnvelope('SELECT_CHAMPION'),
  commandEnvelope('RESET_SESSION'),
  commandEnvelope('REGENERATE_PROPOSAL'),
]);
export type CommandMessage = z.infer<typeof CommandMessage>;

/* ------------------------------------------------------------------ */
/* Hello: 接続直後に1回（再接続時は judgeId と lastSeq を付ける）           */
/* ------------------------------------------------------------------ */

export const HelloMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('hello'),
  sessionId: id,
  judgeId: id.optional(),
  lastSeq: z.number().int().optional(),
  /** 公開環境の合言葉（サーバーに ACCESS_CODE が設定されているときだけ必要） */
  accessCode: z.string().max(100).optional(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

/* ------------------------------------------------------------------ */
/* Ephemeral: 永続化しない・最新値優先（カーソル、ドラッグ中の表示）        */
/* ------------------------------------------------------------------ */

export const EphemeralPayloads = {
  /** 座標はアリーナ要素に対して 0〜1 に正規化（null はアリーナ外） */
  CURSOR_MOVED: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  DRAG_PREVIEW: z.object({ instanceId: id.nullable() }),
  /** 注目しているキャラ（カーソルが乗っている・詳細を開いている）。退場の判定に使う */
  FOCUS_CHANGED: z.object({ hover: id.nullable(), detail: id.nullable() }),
  MIC_STATE_CHANGED: z.object({ on: z.boolean() }),
} as const;
export type EphemeralType = keyof typeof EphemeralPayloads;

const ephemeralEnvelope = <T extends EphemeralType>(type: T) =>
  z.object({
    hip: z.literal(HIP_VERSION),
    kind: z.literal('ephemeral'),
    type: z.literal(type),
    senderId: id.optional(),
    payload: EphemeralPayloads[type],
  });

export const EphemeralMessage = z.discriminatedUnion('type', [
  ephemeralEnvelope('CURSOR_MOVED'),
  ephemeralEnvelope('DRAG_PREVIEW'),
  ephemeralEnvelope('FOCUS_CHANGED'),
  ephemeralEnvelope('MIC_STATE_CHANGED'),
]);
export type EphemeralMessage = z.infer<typeof EphemeralMessage>;

/* ------------------------------------------------------------------ */
/* Signal: Client → Server（返事なし・間引いてよい・状態はまとめた Event で返る）*/
/* ------------------------------------------------------------------ */

export const SoftSignalKind = z.enum(['hesitation', 'positive', 'laugh', 'silence']);
export type SoftSignalKind = z.infer<typeof SoftSignalKind>;

export const SignalPayloads = {
  /** 言葉にならない反応（「うーん」・沈黙・笑い）と、そのとき見ていたカード（ADR-0009） */
  SOFT_SIGNAL: z.object({
    kind: SoftSignalKind,
    targetInstanceId: id.nullable(),
    /** きっかけになった短い言葉（例：「うーん」）。音声そのものは送らない */
    cue: z.string().max(40).optional(),
    features: z
      .object({
        silenceMs: z.number().min(0).max(60_000).optional(),
        rms: z.number().min(0).max(1).optional(),
      })
      .optional(),
  }),
} as const;
export type SignalType = keyof typeof SignalPayloads;

export const SignalMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('signal'),
  type: z.literal('SOFT_SIGNAL'),
  payload: SignalPayloads.SOFT_SIGNAL,
});
export type SignalMessage = z.infer<typeof SignalMessage>;

export const ClientMessage = z.union([HelloMessage, CommandMessage, EphemeralMessage, SignalMessage]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/* ------------------------------------------------------------------ */
/* Event: Server → All（セッション単位の連番 seq）                        */
/* ------------------------------------------------------------------ */

export const EventType = z.enum([
  'SESSION_STARTED',
  'SESSION_RESET',
  'JUDGE_JOINED',
  'JUDGE_LEFT',
  'HOST_CHANGED',
  'CANDIDATE_SPAWNED',
  'CANDIDATE_ARCHIVED',
  'CANDIDATE_LEAVING',
  'CANDIDATE_STAYED',
  'CONSENSUS_UPDATED',
  'PROPOSAL_UPDATED',
  'AI_MODE_CHANGED',
  'PROMOTION_CONFIRMED',
  'FINALIST_REFINEMENT_STARTED',
  'FINALIST_CRITIQUE_POSTED',
  'FINALIST_VERSION_PUBLISHED',
  'CANDIDATE_ANSWERED',
  'JUDGE_UTTERANCE_RECEIVED',
  'CHAMPION_VOTE_STARTED',
  'VOTE_CAST',
  'TIE_DETECTED',
  'CHAMPION_SELECTED',
  /** 好みエンジン（ADR-0009） */
  'TASTE_UPDATED',
  'CANDIDATE_REACTED',
  'CANDIDATE_REVISED',
]);
export type EventType = z.infer<typeof EventType>;

/** イベント固有の情報（アニメーションの手がかり）。状態の正本は snapshot。 */
export const EventDetail = z.record(z.string(), z.unknown());

/**
 * 実装上の判断（ADR-0004 への補足）：
 * Event はその時点の snapshot を同梱する。クライアントは状態を自前で再計算せず、
 * snapshot を置き換え、type と detail は演出にのみ使う。
 */
export const EventMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('event'),
  type: EventType,
  seq: z.number().int(),
  correlationId: z.string().nullable(),
  actorJudgeId: z.string().nullable(),
  detail: EventDetail,
  snapshot: SessionSnapshot,
});
export type EventMessage = z.infer<typeof EventMessage>;

export const WelcomeMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('welcome'),
  judgeId: z.string().nullable(),
  /** null は満員による観覧モード */
  snapshot: SessionSnapshot,
});
export type WelcomeMessage = z.infer<typeof WelcomeMessage>;

export const CommandResultMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('result'),
  commandId: z.string(),
  ok: z.boolean(),
  reason: RejectReason.nullable(),
});
export type CommandResultMessage = z.infer<typeof CommandResultMessage>;

/** 合言葉が無い・違うときに返し、接続を閉じる */
export const AccessDeniedMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('access_denied'),
  reason: z.enum(['required', 'invalid']),
});
export type AccessDeniedMessage = z.infer<typeof AccessDeniedMessage>;

/** 黙って捨てずに、相手が直せる情報を返す（§3.8） */
export const ProtocolErrorCode = z.enum(['UNSUPPORTED_VERSION', 'MALFORMED', 'UNKNOWN_TYPE', 'NOT_JOINED', 'RATE_LIMITED']);
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCode>;

export const ProtocolErrorMessage = z.object({
  hip: z.literal(HIP_VERSION),
  kind: z.literal('protocol_error'),
  code: ProtocolErrorCode,
  detail: z.string(),
  supported: z.array(z.string()),
});
export type ProtocolErrorMessage = z.infer<typeof ProtocolErrorMessage>;

export const ServerMessage = z.union([
  ProtocolErrorMessage,
  AccessDeniedMessage,
  WelcomeMessage,
  EventMessage,
  CommandResultMessage,
  EphemeralMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

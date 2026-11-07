import { z } from 'zod';
import { SessionMode, SessionSnapshot } from './model.ts';
import { RejectReason } from './reasons.ts';

export const HIP_VERSION = '1';

const text = z.string().trim().min(1).max(400);
const id = z.string().min(1).max(80);

/* ------------------------------------------------------------------ */
/* Command: Client → Server（commandId で重複排除）                      */
/* ------------------------------------------------------------------ */

export const CommandPayloads = {
  START_AUDITION: z.object({ theme: text, mode: SessionMode }),
  REQUEST_PROMOTION: z.object({ instanceId: id }),
  NEXT_IDEA: z.object({ instanceId: id.optional() }),
  ASK_CANDIDATE: z.object({ instanceId: id, text }),
  REQUEST_REFINEMENT: z.object({ instanceId: id, text }),
  SUBMIT_UTTERANCE: z.object({
    text,
    source: z.enum(['live', 'text']),
    targetInstanceId: id.optional(),
  }),
  START_CHAMPION_VOTE: z.object({}),
  CAST_VOTE: z.object({ instanceId: id }),
  CLOSE_VOTE: z.object({}),
  RESOLVE_TIE: z.object({ instanceId: id }),
  SELECT_CHAMPION: z.object({ instanceId: id }),
  RESET_SESSION: z.object({}),
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
    payload: CommandPayloads[type],
  });

export const CommandMessage = z.discriminatedUnion('type', [
  commandEnvelope('START_AUDITION'),
  commandEnvelope('REQUEST_PROMOTION'),
  commandEnvelope('NEXT_IDEA'),
  commandEnvelope('ASK_CANDIDATE'),
  commandEnvelope('REQUEST_REFINEMENT'),
  commandEnvelope('SUBMIT_UTTERANCE'),
  commandEnvelope('START_CHAMPION_VOTE'),
  commandEnvelope('CAST_VOTE'),
  commandEnvelope('CLOSE_VOTE'),
  commandEnvelope('RESOLVE_TIE'),
  commandEnvelope('SELECT_CHAMPION'),
  commandEnvelope('RESET_SESSION'),
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

export const ClientMessage = z.union([HelloMessage, CommandMessage, EphemeralMessage]);
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

export const ServerMessage = z.union([
  WelcomeMessage,
  EventMessage,
  CommandResultMessage,
  EphemeralMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

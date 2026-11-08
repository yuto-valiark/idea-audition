import { z } from 'zod';
import { CAMP_VERSION } from './version.ts';

/**
 * メッセージの封筒（docs/protocol/camp-v1.md §3）。中身（payload・snapshot・理由コード）はアプリが渡す。
 */

const id = z.string().min(1).max(80);

/**
 * Command：client → server。必ず result が返る。commandId で重複を排除する。
 * アプリは CommandBase.extend({ type: z.literal('…'), payload }) で1種類ずつ作る。
 */
export const CommandBase = z.object({
  camp: z.literal(CAMP_VERSION),
  kind: z.literal('command'),
  commandId: id,
  sentAt: z.string(),
  /** 画面で見ていた対象の版（違えば STALE_VERSION。§7.2） */
  expected: z.object({ rev: id }).optional(),
});

/** Ephemeral：保存しない・最新の値だけ意味がある。senderId はサーバーが付け直す */
export const EphemeralBase = z.object({
  camp: z.literal(CAMP_VERSION),
  kind: z.literal('ephemeral'),
  senderId: id.optional(),
});

/** Signal：client → server。返事なし・間引いてよい。状態はまとめた Event で返る（§3.7） */
export const SignalBase = z.object({
  camp: z.literal(CAMP_VERSION),
  kind: z.literal('signal'),
});

/** 接続直後に1回。再接続時は参加者 ID と lastSeq を付ける（v1 では参加者 ID を judgeId と呼ぶ） */
export const HelloMessage = z.object({
  camp: z.literal(CAMP_VERSION),
  kind: z.literal('hello'),
  sessionId: id,
  judgeId: id.optional(),
  lastSeq: z.number().int().optional(),
  /** 公開環境の合言葉（サーバーに設定されているときだけ必要） */
  accessCode: z.string().max(100).optional(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

/** Event：server → 全員。セッション単位の連番 seq と、その時点の snapshot 全体を持つ */
export const eventMessage = <E extends z.ZodType, S extends z.ZodType>(type: E, snapshot: S) =>
  z.object({
    camp: z.literal(CAMP_VERSION),
    kind: z.literal('event'),
    type,
    seq: z.number().int(),
    correlationId: z.string().nullable(),
    actorJudgeId: z.string().nullable(),
    /** 演出の手がかり。状態の正本は snapshot */
    detail: z.record(z.string(), z.unknown()),
    snapshot,
  });

export const welcomeMessage = <S extends z.ZodType>(snapshot: S) =>
  z.object({
    camp: z.literal(CAMP_VERSION),
    kind: z.literal('welcome'),
    /** null は満員による観覧 */
    judgeId: z.string().nullable(),
    snapshot,
  });

export const resultMessage = <R extends z.ZodType>(reason: R) =>
  z.object({
    camp: z.literal(CAMP_VERSION),
    kind: z.literal('result'),
    commandId: z.string(),
    ok: z.boolean(),
    reason: reason.nullable(),
  });

/** 合言葉が無い・違うときに返し、接続を閉じる */
export const AccessDeniedMessage = z.object({
  camp: z.literal(CAMP_VERSION),
  kind: z.literal('access_denied'),
  reason: z.enum(['required', 'invalid']),
});
export type AccessDeniedMessage = z.infer<typeof AccessDeniedMessage>;

/** 黙って捨てずに、相手が直せる情報を返す（§3.8） */
export const ProtocolErrorCode = z.enum(['UNSUPPORTED_VERSION', 'MALFORMED', 'UNKNOWN_TYPE', 'NOT_JOINED', 'RATE_LIMITED']);
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCode>;

export const ProtocolErrorMessage = z.object({
  camp: z.literal(CAMP_VERSION),
  kind: z.literal('protocol_error'),
  code: ProtocolErrorCode,
  detail: z.string(),
  supported: z.array(z.string()),
});
export type ProtocolErrorMessage = z.infer<typeof ProtocolErrorMessage>;

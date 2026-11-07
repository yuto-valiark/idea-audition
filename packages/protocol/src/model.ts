import { z } from 'zod';

/** ステージ定員（acceptance-criteria AC-01, AC-04） */
export const LOWER_SLOT_COUNT = 5;
export const UPPER_CAPACITY = 3;
export const MAX_JUDGES = 4;

export const CharacterLocation = z.enum(['lower', 'promoting', 'upper', 'exiting', 'archived']);
export type CharacterLocation = z.infer<typeof CharacterLocation>;

export const SessionStatus = z.enum(['lobby', 'audition_active', 'champion_selection', 'completed']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionMode = z.enum(['solo', 'team']);
export type SessionMode = z.infer<typeof SessionMode>;

export const FinalistStatus = z.enum(['refining', 'critiquing', 'ready']);
export type FinalistStatus = z.infer<typeof FinalistStatus>;

export const CharacterView = z.object({
  instanceId: z.string(),
  designId: z.number().int(),
  name: z.string(),
  accent: z.string(),
  location: CharacterLocation,
  ideaId: z.string(),
  /** 会話で取り上げられた回数 */
  mentions: z.number().int(),
  /** 退場予告中ならその時刻（ISO）。この時刻に下段から退場する */
  leavingAt: z.string().nullable(),
});
export type CharacterView = z.infer<typeof CharacterView>;

export const RevisionView = z.object({
  revisionId: z.string(),
  version: z.number().int().min(1),
  title: z.string(),
  summary: z.string(),
  icon: z.string(),
  keepStrengths: z.array(z.string()),
  improvementPoints: z.array(z.string()),
  basedOnRevisionId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type RevisionView = z.infer<typeof RevisionView>;

export const IdeaView = z.object({
  ideaId: z.string(),
  revisions: z.array(RevisionView).min(1),
});
export type IdeaView = z.infer<typeof IdeaView>;

export const FinalistView = z.object({
  instanceId: z.string(),
  status: FinalistStatus,
});
export type FinalistView = z.infer<typeof FinalistView>;

export const CritiqueView = z.object({
  critiqueId: z.string(),
  round: z.number().int().min(1),
  fromInstanceId: z.string(),
  toInstanceId: z.string(),
  text: z.string(),
  postedAt: z.string(),
});
export type CritiqueView = z.infer<typeof CritiqueView>;

export const JudgeView = z.object({
  judgeId: z.string(),
  label: z.string(),
  color: z.string(),
  isHost: z.boolean(),
  connected: z.boolean(),
  joinedAt: z.string(),
});
export type JudgeView = z.infer<typeof JudgeView>;

export const VoteView = z.object({
  status: z.enum(['open', 'tie', 'closed']),
  /** 締め切り前は「誰が投票したか」だけを公開する（ADR-0004） */
  votedJudgeIds: z.array(z.string()),
  tally: z.record(z.string(), z.number()).nullable(),
  tieInstanceIds: z.array(z.string()),
});
export type VoteView = z.infer<typeof VoteView>;

export const ArchivedIdeaView = z.object({
  ideaId: z.string(),
  designId: z.number().int(),
  characterName: z.string(),
  reason: z.enum(['rotated', 'replaced']),
  archivedAt: z.string(),
});
export type ArchivedIdeaView = z.infer<typeof ArchivedIdeaView>;

export const AnswerView = z.object({
  answerId: z.string(),
  instanceId: z.string(),
  judgeId: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  askedAt: z.string(),
});
export type AnswerView = z.infer<typeof AnswerView>;

/**
 * セッションの投影（クライアントが持つのはこれだけ）。
 * 判定ロジックはサーバーにのみ存在する（ADR-0002）。
 */
export const SessionSnapshot = z.object({
  sessionId: z.string(),
  seq: z.number().int(),
  status: SessionStatus,
  mode: SessionMode,
  theme: z.string(),
  /** 長さ5。準備中の枠は null */
  lowerSlots: z.array(z.string().nullable()),
  /** 0〜3体。並びは昇格順 */
  upper: z.array(FinalistView),
  characters: z.record(z.string(), CharacterView),
  ideas: z.record(z.string(), IdeaView),
  critiques: z.array(CritiqueView),
  answers: z.array(AnswerView),
  ideaBox: z.array(ArchivedIdeaView),
  judges: z.array(JudgeView),
  vote: VoteView.nullable(),
  champion: z
    .object({ instanceId: z.string(), ideaId: z.string(), revisionId: z.string() })
    .nullable(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

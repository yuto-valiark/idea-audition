import type {
  CharacterLocation,
  EventType,
  FinalistStatus,
  RejectReason,
  SessionMode,
  SessionStatus,
} from '@idea-audition/protocol';
import type { Attention } from './attention.ts';
import type { Ledger } from './consensus.ts';
import type { AiMode, ProposalContent } from '@idea-audition/protocol';

export interface Proposal {
  status: 'generating' | 'ready' | 'failed';
  content: ProposalContent | null;
  generatedAt: number | null;
  generatedBy: string | null;
}

/** Domain は React / Firebase / Gemini に依存しない（ADR-0002）。 */

export interface Clock {
  now(): number;
}

export interface IdProvider {
  next(prefix: string): string;
}

/** その案がどの合意・発言を受けて作られたか（系譜、ADR-0007） */
export interface Inspiration {
  /** 論点のラベル（C1 など） */
  claimLabels: string[];
  /** 何を受けたかの短い説明 */
  note: string;
}

export interface IdeaDraft {
  title: string;
  summary: string;
  icon: string;
  /** 生成に使った合意台帳の版。作り置きが古くなったかの判定に使う */
  basedOnConsensus?: number;
  inspiredBy?: Inspiration | null;
}

export interface RevisionDraft {
  title: string;
  summary: string;
  icon?: string;
  keepStrengths: string[];
  improvementPoints: string[];
  reason: string;
  inspiredBy?: Inspiration | null;
}

/** 審査員の発言の記録（合意台帳の材料、時系列） */
export interface UtteranceRecord {
  seq: number;
  judgeId: string;
  text: string;
  source: 'live' | 'text';
  targetInstanceId: string | null;
  intent: string;
  at: number;
}

/** 審査員の行動（発言より強い意思表示として合意の材料にする） */
export interface DecisionRecord {
  kind: 'promoted' | 'rejected' | 'timed_out' | 'voted' | 'champion';
  instanceId: string;
  title: string;
  judgeId: string | null;
  at: number;
}

export interface Revision {
  revisionId: string;
  version: number;
  title: string;
  summary: string;
  icon: string;
  keepStrengths: string[];
  improvementPoints: string[];
  basedOnRevisionId: string | null;
  reason: string | null;
  createdAt: number;
  basedOnConsensus?: number | null;
  inspiredBy?: Inspiration | null;
}

export interface Idea {
  ideaId: string;
  revisions: Revision[];
}

export interface CharacterInstance {
  instanceId: string;
  designId: number;
  location: CharacterLocation;
  ideaId: string;
  spawnedAt: number;
  /** 注目度（下段の入れ替えに使う、attention.ts） */
  attention: Attention;
  /** 退場予告中ならその時刻（この時刻に退場する） */
  leavingAt: number | null;
}

export interface Finalist {
  instanceId: string;
  status: FinalistStatus;
}

export interface Critique {
  critiqueId: string;
  round: number;
  fromInstanceId: string;
  toInstanceId: string;
  text: string;
  postedAt: number;
}

export interface Judge {
  judgeId: string;
  slotIndex: number;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface Vote {
  status: 'open' | 'tie' | 'closed';
  ballots: Map<string, string>;
  tally: Record<string, number> | null;
  tieInstanceIds: string[];
}

export interface ArchivedIdea {
  ideaId: string;
  instanceId: string;
  designId: number;
  reason: 'rotated' | 'replaced' | 'rejected';
  archivedAt: number;
}

export interface Answer {
  answerId: string;
  instanceId: string;
  judgeId: string;
  question: string;
  answer: string | null;
  askedAt: number;
}

export interface DomainEvent {
  type: EventType;
  detail: Record<string, unknown>;
}

export type DomainResult<T = undefined> =
  | { ok: true; events: DomainEvent[]; value: T }
  | { ok: false; reason: RejectReason };

export const ok = <T = undefined>(events: DomainEvent[], value?: T): DomainResult<T> => ({
  ok: true,
  events,
  value: value as T,
});
export const reject = (reason: RejectReason): { ok: false; reason: RejectReason } => ({
  ok: false,
  reason,
});

export type { SessionMode, SessionStatus };

/** 永続化用のセッション状態（Map を配列にしたもの）。schemaVersion を変えたら移行処理を書く */
export interface SessionState {
  schemaVersion: 1;
  status: SessionStatus;
  mode: SessionMode;
  theme: string;
  lowerSlots: (string | null)[];
  upper: Finalist[];
  characters: CharacterInstance[];
  ideas: Idea[];
  critiques: Critique[];
  answers: Answer[];
  ideaBox: ArchivedIdea[];
  judges: Judge[];
  vote: (Omit<Vote, 'ballots'> & { ballots: [string, string][] }) | null;
  champion: { instanceId: string; ideaId: string; revisionId: string } | null;
  stock: IdeaDraft[];
  recentlyDeparted: number[];
  designLastUsedAt: [number, number][];
  /** 以下は ADR-0007 で追加（古い保存データには無い） */
  ledger?: Ledger;
  utterances?: UtteranceRecord[];
  decisions?: DecisionRecord[];
  ledgerCursor?: number;
  proposal?: Proposal | null;
  startedAt?: number | null;
  aiMode?: AiMode;
}

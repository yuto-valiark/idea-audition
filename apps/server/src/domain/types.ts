import type {
  CharacterLocation,
  EventType,
  FinalistStatus,
  RejectReason,
  SessionMode,
  SessionStatus,
} from '@idea-audition/protocol';

/** Domain は React / Firebase / Gemini に依存しない（ADR-0002）。 */

export interface Clock {
  now(): number;
}

export interface IdProvider {
  next(prefix: string): string;
}

export interface IdeaDraft {
  title: string;
  summary: string;
  icon: string;
}

export interface RevisionDraft {
  title: string;
  summary: string;
  icon?: string;
  keepStrengths: string[];
  improvementPoints: string[];
  reason: string;
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
  reason: 'rotated' | 'replaced';
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

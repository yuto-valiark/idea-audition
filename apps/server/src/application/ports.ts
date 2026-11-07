import type { EventMessage } from '@idea-audition/protocol';
import type { IdeaDraft, RevisionDraft } from '../domain/types.ts';

/** AI 生成のポート（ADR-0005 §1）。GeminiGateway と FixtureGateway が実装する。 */
export interface IdeaGenerationPort {
  readonly name: string;
  generateIdeas(input: { theme: string; count: number; avoidTitles: string[] }): Promise<IdeaDraft[]>;
  /**
   * 上段の改良。相互批評を含めて1回の構造化出力で受け取る（ADR-0005 §4・§6 案A）。
   */
  refine(input: RefineInput): Promise<RefineOutput>;
  answer(input: {
    theme: string;
    idea: { title: string; summary: string };
    characterName: string;
    question: string;
  }): Promise<string>;
}

export interface RefineParticipant {
  instanceId: string;
  characterName: string;
  title: string;
  summary: string;
  version: number;
}

export interface RefineInput {
  theme: string;
  trigger: 'promotion' | 'instruction' | 'arrival';
  participants: RefineParticipant[];
  /** 改良版を作る対象（arrival では全員） */
  targets: string[];
  rounds: number;
  instruction: string | null;
}

export interface RefineOutput {
  critiques: { round: number; fromInstanceId: string; toInstanceId: string; text: string }[];
  revisions: Record<string, RevisionDraft>;
}

/** 確定イベントの永続化（Day 2 で Firestore 実装を追加） */
export interface EventLogPort {
  append(sessionId: string, event: EventMessage): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): () => void;
  setInterval(fn: () => void, ms: number): () => void;
}

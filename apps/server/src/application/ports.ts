import type { EventMessage } from '@idea-audition/protocol';
import type { IdeaDraft, RevisionDraft, SessionState } from '../domain/types.ts';

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

/** 確定イベントの記録（1件分） */
export interface StoredEvent {
  seq: number;
  type: EventMessage['type'];
  detail: Record<string, unknown>;
  actorJudgeId: string | null;
  correlationId: string | null;
  at: string;
}

/**
 * セッションの永続化（ADR-0003）。正本はメモリのアクターで、これは控え。
 * サーバー再起動時に load で復元する。
 */
export interface SessionStorePort {
  readonly name: string;
  load(sessionId: string): Promise<{ seq: number; state: SessionState } | null>;
  /** 確定イベントと、その時点のセッション状態をまとめて書く */
  commit(sessionId: string, seq: number, state: SessionState, events: StoredEvent[]): Promise<void>;
}

/** 音声の文字起こし（Gemini Live）。開いている間だけ音声を受け付ける */
export interface SpeechTranscriptionPort {
  readonly name: string;
  open(callbacks: {
    onInterim(text: string): void;
    onFinal(text: string): void;
    onClose(reason: string): void;
  }): Promise<TranscriptionStream>;
}

export interface TranscriptionStream {
  /** 16kHz・モノラル・16bit PCM */
  sendAudio(pcm: Buffer): void;
  close(): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): () => void;
  setInterval(fn: () => void, ms: number): () => void;
}

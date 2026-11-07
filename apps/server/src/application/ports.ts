import type { EventMessage, ProposalContent } from '@idea-audition/protocol';
import type { IdeaDraft, RevisionDraft, SessionState } from '../domain/types.ts';

/**
 * LLM に渡す「審査の文脈」（ADR-0007 の L1）。合意台帳と審査員の行動から作る。
 * 版（version）が変わるまで同じ内容になるので、プロンプトの前半に置いてキャッシュを効かせる。
 */
export interface ConsensusContext {
  version: number;
  agreed: { label: string; text: string; supporters: string[] }[];
  proposed: { label: string; text: string; support: string[]; oppose: string[] }[];
  rejected: { label: string; text: string }[];
  /** 上段に選ばれた・会話でよく話題になった案 */
  favoredIdeas: string[];
  /** 見送られた案 */
  rejectedIdeas: string[];
  /** 直近の発言（審査員ラベルつき） */
  recentRemarks: { judge: string; text: string }[];
}

/** 合意台帳の差分を作るための入力。ID は使わず、審査員は「審査員 A」、論点は C1 のラベルで渡す */
export interface ConsensusUpdateInput {
  theme: string;
  /** この回で add_claim した論点に振られる最初の番号（C{n}） */
  nextClaimNumber: number;
  judges: string[];
  claims: { label: string; text: string; status: string; stances: { judge: string; stance: 'support' | 'oppose' }[] }[];
  utterances: { seq: number; judge: string; text: string; target: string | null; replyToClaim: string | null }[];
  decisions: { kind: string; title: string; judge: string | null }[];
}

/** 企画書を作るための材料。審査の記録から作り、LLM には事実として渡す */
export interface ProposalInput {
  theme: string;
  context: ConsensusContext;
  champion: {
    characterName: string;
    revisions: { version: number; title: string; summary: string; keepStrengths: string[]; improvementPoints: string[]; reason: string | null }[];
  };
  critiques: string[];
  qa: { question: string; answer: string }[];
  otherFinalists: string[];
}

/** LLM が提案する台帳の操作（ラベルで指す。サーバーが ID に直して当てはめる） */
export type ConsensusOpDraft =
  | { op: 'add_claim'; text: string; judge: string | null; stance: 'support' | 'oppose' | null; seq: number | null }
  | { op: 'set_stance'; label: string; judge: string; stance: 'support' | 'oppose'; seq: number | null }
  | { op: 'supersede'; label: string; byLabel: string };

/** AI 生成のポート（ADR-0005 §1）。GeminiGateway と FixtureGateway が実装する。 */
export interface IdeaGenerationPort {
  readonly name: string;
  generateIdeas(input: {
    theme: string;
    count: number;
    avoidTitles: string[];
    context?: ConsensusContext;
  }): Promise<IdeaDraft[]>;
  /** 優勝案の企画書（第1部）を作る */
  generateProposal(input: ProposalInput): Promise<ProposalContent>;
  /** 会話と行動から、合意台帳への操作を提案する（ADR-0007） */
  updateConsensus(input: ConsensusUpdateInput): Promise<ConsensusOpDraft[]>;
  /**
   * 上段の改良。相互批評を含めて1回の構造化出力で受け取る（ADR-0005 §4・§6 案A）。
   */
  refine(input: RefineInput): Promise<RefineOutput>;
  answer(input: {
    theme: string;
    idea: { title: string; summary: string };
    characterName: string;
    question: string;
    context?: ConsensusContext;
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
  context?: ConsensusContext;
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

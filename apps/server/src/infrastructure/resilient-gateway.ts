import type { ConsensusUpdateInput, IdeaGenerationPort, ProposalInput, RefineInput } from '../application/ports.ts';

/**
 * 本命のゲートウェイが失敗したら、代わりのゲートウェイ（固定データ）で応答する。
 * デモを止めないための仕組み（ADR-0005 §1、仕様書 12.3）。
 */
export class ResilientGateway implements IdeaGenerationPort {
  readonly name: string;

  constructor(
    private readonly primary: IdeaGenerationPort,
    private readonly fallback: IdeaGenerationPort,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.name = `${primary.name}(fallback:${fallback.name})`;
  }

  generateIdeas(input: Parameters<IdeaGenerationPort['generateIdeas']>[0]) {
    return this.withFallback('generateIdeas', () => this.primary.generateIdeas(input), () => this.fallback.generateIdeas(input));
  }

  refine(input: RefineInput) {
    return this.withFallback('refine', () => this.primary.refine(input), () => this.fallback.refine(input));
  }

  generateProposal(input: ProposalInput) {
    return this.withFallback('generateProposal', () => this.primary.generateProposal(input), () => this.fallback.generateProposal(input));
  }

  updateConsensus(input: ConsensusUpdateInput) {
    return this.withFallback('updateConsensus', () => this.primary.updateConsensus(input), () => this.fallback.updateConsensus(input));
  }

  answer(input: Parameters<IdeaGenerationPort['answer']>[0]) {
    return this.withFallback('answer', () => this.primary.answer(input), () => this.fallback.answer(input));
  }

  private async withFallback<T>(op: string, main: () => Promise<T>, alt: () => Promise<T>): Promise<T> {
    try {
      return await main();
    } catch (e) {
      this.log(`[ai] ${op}: ${this.primary.name} failed, using ${this.fallback.name} (${String(e)})`);
      return alt();
    }
  }
}

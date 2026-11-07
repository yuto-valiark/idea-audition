import { z } from 'zod';
import type { IdeaDraft, RevisionDraft } from '../../domain/types.ts';
import type { IdeaGenerationPort, RefineInput, RefineOutput } from '../../application/ports.ts';

/**
 * Gemini（Vertex AI）による生成（ADR-0005）。
 * - 構造化出力（JSON Schema）で受け取り、Zod で検証する
 * - 不正な出力は1回だけやり直し、それでも駄目なら例外（呼び出し側で固定データへ切り替える）
 * - 参加キャラのIDは P1, P2… に置き換えて渡し、モデルにIDを扱わせない
 */

/** @google/genai の models.generateContent と同じ形（テストで差し替えられるよう構造的に定義） */
export interface GenerateContentClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{ text?: string | undefined }>;
  };
}

export interface ModelProfile {
  model: string;
  /** モデルごとに対応する思考レベルが違う（例：gemini-3.8-flash は MINIMAL 非対応） */
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  timeoutMs: number;
}

export interface GeminiConfig {
  /** 案の生成・回答（速さ優先） */
  fast: ModelProfile;
  /** 上段の改良・相互批評（質優先） */
  refine: ModelProfile;
}

const ICONS = ['♧', '♡', '☆', '✧', '◇', '◎', '⌁', '☾', '☀'] as const;

const SYSTEM = `あなたは企画決めツール「IDEA AUDITION」に登場する、AIキャラクターたちの台本を書く担当です。
キャラクターは人間の審査員の前で企画をプレゼンし、選ばれると互いに批評しながら企画を磨きます。
- 日本語で、親しみやすく短く書く
- 実在の企業名・人名・商標は使わない
- 指定された文字数を必ず守る（画面のフリップに収めるため）
- 出力は指定された JSON だけ`;

const IdeasSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().min(1),
        icon: z.enum(ICONS),
      }),
    )
    .min(1),
});

const RefineSchema = z.object({
  critiques: z.array(z.object({ round: z.number().int(), text: z.string().min(1) })),
  revisions: z
    .array(
      z.object({
        participant: z.string(),
        title: z.string().min(1),
        summary: z.string().min(1),
        keepStrengths: z.array(z.string().min(1)).min(1),
        improvementPoints: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1),
      }),
    )
    .min(1),
});

const AnswerSchema = z.object({ answer: z.string().min(1) });

function jsonSchema(schema: z.ZodType) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** モデルが改行を "\\n" のまま返すことがあるため正規化し、長すぎる文字列は切る */
function clean(text: string, maxLen: number) {
  const t = text.replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

function cleanSummary(text: string) {
  return clean(text, 60)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('\n');
}

export class GeminiGateway implements IdeaGenerationPort {
  readonly name = 'gemini';

  constructor(
    private readonly client: GenerateContentClient,
    private readonly config: GeminiConfig,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async generateIdeas(input: { theme: string; count: number; avoidTitles: string[] }): Promise<IdeaDraft[]> {
    const avoid = input.avoidTitles.slice(-30);
    const prompt = `テーマ：「${input.theme}」
このテーマの新しい企画案を ${input.count} 個、それぞれ別の切り口で出してください。
- title：企画名。12文字以内
- summary：説明。20文字以内の文を2行（改行で区切る）。1行目はキャッチコピー、2行目は具体的な中身
- icon：企画の雰囲気に合う記号を ${ICONS.join(' ')} から1つ
${avoid.length ? `次の企画名と同じ・似たものは出さない：${avoid.join('、')}` : ''}`;
    const out = await this.call('generateIdeas', this.config.fast, prompt, IdeasSchema);
    return out.ideas.slice(0, input.count).map((i) => ({
      title: clean(i.title, 16),
      summary: cleanSummary(i.summary),
      icon: i.icon,
    }));
  }

  async refine(input: RefineInput): Promise<RefineOutput> {
    const label = new Map(input.participants.map((p, i) => [p.instanceId, `P${i + 1}`]));
    const byLabel = new Map(input.participants.map((p, i) => [`P${i + 1}`, p]));
    const n = input.participants.length;
    const order = Array.from({ length: n > 1 ? input.rounds : 0 }, (_, i) => ({
      round: i + 1,
      from: input.participants[i % n]!,
      to: input.participants[(i + 1) % n]!,
    }));
    const targets = input.participants.filter((p) => input.targets.includes(p.instanceId));

    const prompt = `テーマ：「${input.theme}」
最終オーディションに残った企画：
${input.participants
  .map((p) => `- ${label.get(p.instanceId)}（キャラ名 ${p.characterName}）：「${p.title}」${p.summary.replace(/\n/g, ' ')}`)
  .join('\n')}

${
  order.length
    ? `まず、キャラ同士の短い相互批評を ${order.length} ラウンド書いてください。各ラウンドの話し手と相手は次のとおり：
${order.map((o) => `- ラウンド${o.round}：${label.get(o.from.instanceId)} → ${label.get(o.to.instanceId)}`).join('\n')}
- text：40文字以内。相手の企画への具体的な指摘や提案。前のラウンドへの返しになっていてよい。口調はキャラらしく
`
    : 'critiques は空配列にしてください。\n'
}
次に、${targets.map((t) => label.get(t.instanceId)).join('、')} の企画を改良した新しい版を作ってください。
${input.instruction ? `審査員からの指示：「${input.instruction}」を必ず反映する。\n` : ''}${
      order.length ? '相互批評で受けた指摘も反映する。\n' : '審査員が注目した強みを残し、実現性と面白さを高める。\n'
    }- participant：P1 などのラベル
- title：改良後の企画名。14文字以内
- summary：20文字以内の文を2行（改行で区切る）
- keepStrengths：元の案から残す強み。1〜2個、各20文字以内
- improvementPoints：今回の改善ポイント。2個、各24文字以内
- reason：何を受けてどう変えたか。40文字以内`;

    const out = await this.call('refine', this.config.refine, prompt, RefineSchema);

    // 話し手と相手はモデルに任せず、決めた順番を使う（ADR-0005 §6）
    const critiques = order.map((o, i) => ({
      round: o.round,
      fromInstanceId: o.from.instanceId,
      toInstanceId: o.to.instanceId,
      text: clean(out.critiques[i]?.text ?? '', 48),
    })).filter((c) => c.text);

    const revisions: Record<string, RevisionDraft> = {};
    for (const r of out.revisions) {
      const p = byLabel.get(r.participant.trim());
      if (!p || !input.targets.includes(p.instanceId) || revisions[p.instanceId]) continue;
      revisions[p.instanceId] = {
        title: clean(r.title, 18),
        summary: cleanSummary(r.summary),
        keepStrengths: r.keepStrengths.slice(0, 2).map((s) => clean(s, 28)),
        improvementPoints: r.improvementPoints.slice(0, 3).map((s) => clean(s, 32)),
        reason: clean(r.reason, 56),
      };
    }
    if (Object.keys(revisions).length === 0) throw new Error('refine: no usable revisions');
    return { critiques, revisions };
  }

  async answer(input: {
    theme: string;
    idea: { title: string; summary: string };
    characterName: string;
    question: string;
  }): Promise<string> {
    const prompt = `テーマ：「${input.theme}」
あなたはキャラ「${input.characterName}」で、企画「${input.idea.title}」（${input.idea.summary.replace(/\n/g, ' ')}）をプレゼンしています。
審査員からの質問：「${input.question}」
キャラとして、質問に具体的に答えてください。100文字以内。企画の内容は変えずに説明する。`;
    const out = await this.call('answer', this.config.fast, prompt, AnswerSchema);
    return clean(out.answer, 140);
  }

  private async call<T>(op: string, profile: ModelProfile, prompt: string, schema: z.ZodType<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      try {
        const res = await this.client.models.generateContent({
          model: profile.model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM,
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema(schema),
            thinkingConfig: { thinkingLevel: profile.thinkingLevel },
            temperature: 1,
            abortSignal: AbortSignal.timeout(profile.timeoutMs),
          },
        });
        const parsed = schema.safeParse(JSON.parse(res.text ?? ''));
        if (!parsed.success) throw new Error(`schema mismatch: ${parsed.error.issues[0]?.message ?? ''}`);
        this.log(`[ai] ${op} ok ${Date.now() - started}ms model=${profile.model} attempt=${attempt}`);
        return parsed.data;
      } catch (e) {
        lastError = e;
        this.log(`[ai] ${op} failed ${Date.now() - started}ms model=${profile.model} attempt=${attempt}: ${String(e)}`);
      }
    }
    throw lastError;
  }
}

import { z } from 'zod';
import type { IdeaDraft, Inspiration, RevisionDraft } from '../../domain/types.ts';
import type {
  ConsensusContext,
  ConsensusOpDraft,
  ConsensusUpdateInput,
  IdeaGenerationPort,
  ProposalInput,
  RefineInput,
  RefineOutput,
  TasteHint,
  VaryInput,
} from '../../application/ports.ts';
import { ProposalContent, TASTE_AXES } from '@idea-audition/protocol';

/**
 * Gemini（Vertex AI）による生成（ADR-0005、ADR-0007）。
 * - 構造化出力（JSON Schema）で受け取り、Zod で検証する
 * - 不正な出力は1回だけやり直し、それでも駄目なら例外（呼び出し側で固定データへ切り替える）
 * - 参加キャラは P1, P2…、論点は C1, C2…、審査員は「審査員 A」のラベルで渡し、内部IDを扱わせない
 * - プロンプトは「L0 固定の指示 → L1 審査の文脈（合意台帳） → L2/L3 今回の処理」の順に並べる。
 *   前半が同じになるため、Gemini の暗黙キャッシュが効きやすい（cachedContentTokenCount をログに出す）
 */

/** @google/genai の models.generateContent と同じ形（テストで差し替えられるよう構造的に定義） */
export interface GenerateContentClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{ text?: string | undefined; usageMetadata?: { cachedContentTokenCount?: number; promptTokenCount?: number } }>;
  };
}

export interface ModelProfile {
  model: string;
  /** モデルごとに対応する思考レベルが違う（例：gemini-3.8-flash は MINIMAL 非対応） */
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  timeoutMs: number;
}

export interface GeminiConfig {
  /** 案の生成・回答・合意の抽出（速さ優先） */
  fast: ModelProfile;
  /** 上段の改良・相互批評（質優先） */
  refine: ModelProfile;
}

const ICONS = ['♧', '♡', '☆', '✧', '◇', '◎', '⌁', '☾', '☀'] as const;

const SYSTEM = `あなたは企画決めツール「IDEA AUDITION」の裏方です。
AIキャラクターが人間の審査員の前で企画をプレゼンし、選ばれると互いに批評しながら企画を磨きます。
審査員の会話から決まったこと（合意）と、まだ揉めていること（提案中）は「審査の文脈」として渡されます。
- 合意している論点には反しない。提案中の論点は参考にしてよいが、決まったことにはしない
- 「反しない」は「すべての案をその方向に寄せる」という意味ではない。案を出すときは、合意や選ばれた案とは別の切り口も必ず残す
- 却下された論点・見送られた案の方向は繰り返さない
- 日本語で、親しみやすく短く書く。実在の企業名・人名・商標は使わない
- 指定された文字数を必ず守る（画面のフリップに収めるため）
- 出力は指定された JSON だけ`;

/** 8軸のプロフィール（-1〜+1）。軸の名前で受け取り、TASTE_AXES の順の配列に直す */
const ProfileSchema = z.object(
  Object.fromEntries(TASTE_AXES.map((a) => [a.key, z.number()])) as Record<(typeof TASTE_AXES)[number]['key'], z.ZodNumber>,
);
const toProfile = (p: Record<string, number>) => TASTE_AXES.map((a) => Math.max(-1, Math.min(1, Number(p[a.key]) || 0)));
const AXIS_GUIDE = TASTE_AXES.map((a) => `${a.key}=${a.label}：${a.description}`).join(' / ');

const IdeaItem = z.object({
  /** 何番の枠の案か（1 から）。枠の指定が無いときは 0 */
  slot: z.number().int(),
  title: z.string().min(1),
  /** 企画名の読み（全角カタカナ） */
  reading: z.string(),
  summary: z.string().min(1),
  /** 詳細画面の3行：誰の・何の困りごとを・どう解くか */
  who: z.string(),
  pain: z.string(),
  how: z.string(),
  icon: z.enum(ICONS),
  /** 受けた論点のラベル（C1 など）。新しい切り口の案は空 */
  inspiredBy: z.array(z.string()),
  /** 何を受けたか。20文字以内。新しい切り口の案は空文字 */
  note: z.string(),
  profile: ProfileSchema,
});

const IdeasSchema = z.object({ ideas: z.array(IdeaItem).min(1) });

const VarySchema = z.object({
  title: z.string().min(1),
  reading: z.string(),
  summary: z.string().min(1),
  icon: z.enum(ICONS),
  keepStrength: z.string(),
  improvement: z.string(),
  changeNote: z.string(),
  profile: ProfileSchema,
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
        inspiredBy: z.array(z.string()),
      }),
    )
    .min(1),
});

const AnswerSchema = z.object({ understood: z.boolean(), answer: z.string() });

const ConsensusSchema = z.object({
  ops: z.array(
    z.object({
      op: z.enum(['add_claim', 'set_stance', 'supersede']),
      /** add_claim：論点の文（30文字以内） */
      text: z.string(),
      /** add_claim / set_stance：審査員のラベル（審査員 A など）。言い出した人が不明なら空文字 */
      judge: z.string(),
      stance: z.enum(['support', 'oppose', 'none']),
      /** set_stance / supersede：対象の論点ラベル */
      label: z.string(),
      /** supersede：置き換える新しい論点ラベル */
      byLabel: z.string(),
      /** 根拠にした発言の seq。無ければ 0 */
      seq: z.number().int(),
    }),
  ),
});

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

/**
 * L1：審査の文脈。合意台帳の版が変わるまで同じ文字列になるよう、並びと書式を固定する。
 * （直近の発言は版が同じでも変わるので、ここには入れず各処理の後半に置く）
 */
export function renderContext(theme: string, ctx: ConsensusContext | undefined): string {
  const lines = [`# テーマ\n${theme}`, `# 審査の文脈（合意台帳 v${ctx?.version ?? 0}）`];
  if (!ctx) return [...lines, '（まだ会話はありません）'].join('\n');
  const list = (items: string[]) => (items.length ? items.join('\n') : '（なし）');
  lines.push(
    `## 合意している論点（守る）\n${list(ctx.agreed.map((c) => `- ${c.label}：${c.text}（賛成：${c.supporters.join('・') || '—'}）`))}`,
    `## 提案中の論点（参考）\n${list(
      ctx.proposed.map((c) => `- ${c.label}：${c.text}（賛成：${c.support.join('・') || '—'}／反対：${c.oppose.join('・') || '—'}）`),
    )}`,
    `## 却下された論点（避ける）\n${list(ctx.rejected.map((c) => `- ${c.label}：${c.text}`))}`,
    `## 審査員に選ばれた・よく話題になった案\n${list(ctx.favoredIdeas.map((t) => `- ${t}`))}`,
    `## 見送られた案（同じ方向は避ける）\n${list(ctx.rejectedIdeas.map((t) => `- ${t}`))}`,
  );
  return lines.join('\n');
}

function renderRemarks(ctx: ConsensusContext | undefined) {
  if (!ctx?.recentRemarks.length) return '';
  return `\n# 直近の発言\n${ctx.recentRemarks.map((r) => `- ${r.judge}：「${r.text}」`).join('\n')}\n`;
}

/** 読みはカタカナだけ残す（ひらがなはカタカナに直す）。使えなければ undefined */
function toReading(text: string): string | undefined {
  const kana = text.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/[^ァ-ヶー]/g, '');
  return kana.length >= 2 ? kana : undefined;
}

/** 好みの要約（審査員ごとの好き・苦手と、割れている軸） */
function renderTaste(taste: TasteHint | undefined) {
  if (!taste || (taste.judges.length === 0 && !taste.divergence)) return '';
  const lines = taste.judges.map(
    (j) => `- ${j.label}：好き＝${j.likes.join('・') || '—'}／苦手＝${j.dislikes.join('・') || '—'}`,
  );
  return `\n# 審査員の好み（これまでの反応から推定）\n${lines.join('\n')}${taste.divergence ? `\n- ${taste.divergence}` : ''}\n`;
}

function toInspiration(labels: string[], note: string, ctx: ConsensusContext | undefined): Inspiration | null {
  const known = new Set([...(ctx?.agreed ?? []), ...(ctx?.proposed ?? [])].map((c) => c.label));
  const claimLabels = [...new Set(labels.map((l) => l.trim()).filter((l) => known.has(l)))];
  if (claimLabels.length === 0) return null;
  return { claimLabels, note: clean(note, 28) || `${claimLabels.join('・')} を反映` };
}

export class GeminiGateway implements IdeaGenerationPort {
  readonly name = 'gemini';

  constructor(
    private readonly client: GenerateContentClient,
    private readonly config: GeminiConfig,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /**
   * 優勝案の企画書（第1部）。審査の記録（改良の経緯・合意・批評・質疑）を事実として渡し、
   * 記録に無い数字や事実は assumptions（要検証）に書かせる。
   */
  async generateProposal(input: ProposalInput): Promise<ProposalContent> {
    const revs = input.champion.revisions;
    const prompt = `${renderContext(input.theme, input.context)}

# 優勝した企画（キャラ：${input.champion.characterName}）の改良の経緯
${revs
  .map(
    (r) =>
      `- Ver.${r.version}「${r.title}」${r.summary.replace(/\n/g, ' ')}${r.reason ? `／変えた理由：${r.reason}` : ''}${
        r.improvementPoints.length ? `／改善：${r.improvementPoints.join('・')}` : ''
      }${r.keepStrengths.length ? `／残した強み：${r.keepStrengths.join('・')}` : ''}`,
  )
  .join('\n')}
# 最終オーディションでの批評
${input.critiques.map((c) => `- ${c}`).join('\n') || '（なし）'}
# 審査員からの質問と回答
${input.qa.map((q) => `- Q：${q.question}／A：${q.answer}`).join('\n') || '（なし）'}
# 一緒に最終オーディションに残った案
${input.otherFinalists.map((t) => `- ${t}`).join('\n') || '（なし）'}

# 今回の依頼
この優勝案を、チームがそのまま動き出せる「企画書」にしてください。
- 審査で合意した論点には必ず沿う。改良の経緯で決まった内容（最終版）を正とする
- 審査の記録に無い数字・事実（予算額、期間、協力先など）は断定せず、目安として書き、assumptions に「要検証」として挙げる
- 実在の企業名・人名・商標は使わない
- title：最終版の企画名（そのまま使う）
- catchphrase：一言でいうと。25文字以内
- background：背景。120文字以内
- problem：解決したい課題（誰が・どんな場面で困っているか）。120文字以内
- target：対象者。60文字以内
- value：提供する価値。100文字以内
- overview：企画の概要。160文字以内
- features：主な内容を3〜4個（name 15文字以内、detail 60文字以内）
- plan：進め方を3〜4段階（phase 10文字以内、period 例「1〜2週目」、tasks 60文字以内）。小さく試して広げる順に
- resources：必要な人・体制。80文字以内
- budget：予算の目安と内訳。80文字以内（要検証の目安として）
- risks：リスクと対策を2〜3組（各50文字以内）
- kpis：成果の測り方を3個（各30文字以内）
- nextActions：明日からやる次の一手を3個（各30文字以内）
- assumptions：要検証の前提を2〜4個（各40文字以内）`;
    const profile = { ...this.config.refine, timeoutMs: Math.max(this.config.refine.timeoutMs, 45_000) };
    const out = await this.call('generateProposal', profile, prompt, ProposalContent);
    const final = revs.at(-1)!;
    return { ...out, title: final.title };
  }

  async generateIdeas(input: {
    theme: string;
    count: number;
    avoidTitles: string[];
    context?: ConsensusContext;
    taste?: TasteHint;
  }): Promise<IdeaDraft[]> {
    const avoid = input.avoidTitles.slice(-30);
    const ctx = input.context;
    const slots = input.taste?.slots ?? [];
    const count = slots.length || input.count;
    const hasDirection = !!ctx && ctx.agreed.length + ctx.proposed.length > 0;
    const follow = hasDirection ? Math.ceil(count / 2) : 0;
    // 好み・折衷の枠だけが合意や選ばれた案を伸ばしてよい。探る枠・ワイルドカードの枠はそこから離れる（同じ方向ばかりにならないように）
    const awayFrom = [...(ctx?.favoredIdeas ?? []), ...(ctx?.agreed ?? []).map((c) => c.text)].slice(0, 6);
    const prompt = `${renderContext(input.theme, ctx)}
${renderRemarks(ctx)}${renderTaste(input.taste)}
# 今回の依頼
このテーマの新しい企画案を ${count} 個、それぞれ別の切り口で出してください。
${
  slots.length
    ? `- 下の「枠」1つにつき1案。slot に枠の番号を入れ、その枠の「方向」と「発想の型」に従って考える
${slots.map((sl, i) => `  枠${i + 1}：方向＝${sl.direction}／発想の型＝${sl.persona.name}（${sl.persona.how}）`).join('\n')}`
    : '- slot は 0'
}
${
  follow > 0
    ? `- 合意・提案中の論点を伸ばしてよいのは、方向が「〜が好む方向」「両立・折衷」の枠だけ。その案は inspiredBy に受けた論点のラベル（例 C1）、note に何を受けたか（20文字以内）を入れる
- それ以外の枠（「逆の方向」「まだ出ていない方向」「意外で大胆な案」）は、inspiredBy は空、note は空文字${
        awayFrom.length ? `。次の案・論点と同じ対象・同じ手段は使わず、テーマの別の側面から考える：${awayFrom.join('／')}` : ''
      }`
    : '- まだ合意が無いので、inspiredBy は空、note は空文字'
}
- title：企画名。12文字以内
- reading：企画名の読みを全角カタカナで（英字も読みで。例「学食SNS」→「ガクショクエスエヌエス」）
- summary：説明。20文字以内の文を2行（改行で区切る）。1行目はキャッチコピー、2行目は具体的な中身
- who：誰のための案か。20文字以内（例「一人暮らしの大学生」）
- pain：その人のどんな困りごと・不満を扱うか。24文字以内
- how：どうやって解くか（仕組み）。24文字以内
- icon：企画の雰囲気に合う記号を ${ICONS.join(' ')} から1つ
- profile：この案を8つの軸で -1〜+1 で採点する（0 が普通）。${AXIS_GUIDE}
${avoid.length ? `- 次の企画名と同じ・似たものは出さない：${avoid.join('、')}` : ''}`;
    // 件数が多いほど返事が長くなるので、時間切れまでの時間も延ばす（1件あたり2秒を足す）
    const profile = { ...this.config.fast, timeoutMs: Math.max(this.config.fast.timeoutMs, 6_000 + count * 2_000) };
    const out = await this.call('generateIdeas', profile, prompt, IdeasSchema);
    return out.ideas.slice(0, count).map((i, n) => {
      const slot = slots[(i.slot > 0 ? i.slot : n + 1) - 1];
      return {
        title: clean(i.title, 16),
        summary: cleanSummary(i.summary),
        icon: i.icon,
        inspiredBy: toInspiration(i.inspiredBy, i.note, ctx),
        profile: toProfile(i.profile),
        persona: slot?.persona.name,
        reading: toReading(i.reading),
        ...(i.who.trim() && i.how.trim() ? { outline: { who: clean(i.who, 24), pain: clean(i.pain, 30), how: clean(i.how, 30) } } : {}),
      };
    });
  }

  /** 迷いを受けた別案。元の案の良さは残し、迷われた点を変える（ADR-0009 ③） */
  async varyIdea(input: VaryInput): Promise<IdeaDraft> {
    const prompt = `${renderContext(input.theme, input.context)}
# 今回の依頼
審査員が次の案を見て迷っています（反応：「${input.concern}」）。
キャラクター「${input.characterName}」として、同じ案の別バージョンを1つ作ってください。
- 元の案：${input.idea.title}／${input.idea.summary.replace(/\n/g, ' ')}
- 元の案の一番の良さは残し、迷われていそうな点（大がかりすぎる・ピンと来ない・誰向けか分からない、など）を1つ選んで変える
- title：企画名。12文字以内。元の企画名と分かる程度に似せてよい
- reading：企画名の読みを全角カタカナで
- summary：20文字以内の文を2行（改行で区切る）。1行目はキャッチコピー、2行目は何を変えたか
- icon：${ICONS.join(' ')} から1つ
- keepStrength：元の案から残した一番の良さ。20文字以内
- improvement：今回変えた点。20文字以内
- changeNote：審査員に向けた、変えた理由のひとこと。20文字以内（例「大がかりすぎたので小さく始める形に」）。審査員の発言をそのまま引用しない
- profile：新しい案を8つの軸で -1〜+1 で採点する。${AXIS_GUIDE}`;
    const out = await this.call('varyIdea', this.config.fast, prompt, VarySchema);
    const keep = clean(out.keepStrength, 28);
    const improve = clean(out.improvement, 28);
    return {
      title: clean(out.title, 16),
      summary: cleanSummary(out.summary),
      icon: out.icon,
      profile: toProfile(out.profile),
      reading: toReading(out.reading),
      ...(keep ? { keepStrengths: [keep] } : {}),
      ...(improve ? { improvementPoints: [improve] } : {}),
      ...(clean(out.changeNote, 28) ? { changeNote: clean(out.changeNote, 28) } : {}),
    };
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
    const ctx = input.context;

    const prompt = `${renderContext(input.theme, ctx)}
${renderRemarks(ctx)}
# 最終オーディションに残った企画
${input.participants
  .map((p) => `- ${label.get(p.instanceId)}（キャラ名 ${p.characterName}）：「${p.title}」${p.summary.replace(/\n/g, ' ')}`)
  .join('\n')}

# 今回の依頼
${
  order.length
    ? `まず、キャラ同士の短い相互批評を ${order.length} ラウンド書いてください。各ラウンドの話し手と相手は次のとおり：
${order.map((o) => `- ラウンド${o.round}：${label.get(o.from.instanceId)} → ${label.get(o.to.instanceId)}`).join('\n')}
- text：40文字以内。相手の企画への具体的な指摘や提案。合意している論点に反している点があれば指摘する。前のラウンドへの返しになっていてよい。口調はキャラらしく
`
    : 'critiques は空配列にしてください。\n'
}
次に、${targets.map((t) => label.get(t.instanceId)).join('、')} の企画を改良した新しい版を作ってください。
${input.instruction ? `審査員からの指示：「${input.instruction}」を必ず反映する。\n` : ''}${
      order.length ? '相互批評で受けた指摘も反映する。\n' : '審査員が注目した強みを残し、実現性と面白さを高める。\n'
    }合意している論点には必ず沿わせる。
- participant：P1 などのラベル
- title：企画名。元の企画名をそのまま使うのが基本。中身の対象や仕組みが大きく変わったときだけ変える（14文字以内）。変える場合も元の名前が分かる程度に似せる。漢字の誤り（「夕」と「タ」など）に注意
- summary：20文字以内の文を2行（改行で区切る）
- keepStrengths：元の案から残す強み。1〜2個、各20文字以内
- improvementPoints：今回の改善ポイント。2個、各24文字以内
- reason：何を受けてどう変えたか。40文字以内
- inspiredBy：反映した論点のラベル（例 C1）。無ければ空`;

    // 決勝に人が加わったときの相互批評は、短い掛け合いと小さな改良なので速いモデルで回す（待ち時間を短く）。
    // 審査員の頼み・昇格したときの改良は、質を優先して改良用のモデルを使う
    const profile = input.trigger === 'arrival' ? this.config.fast : this.config.refine;
    const out = await this.call('refine', profile, prompt, RefineSchema);

    // 話し手と相手はモデルに任せず、決めた順番を使う（ADR-0005 §6）
    const critiques = order
      .map((o, i) => ({
        round: o.round,
        fromInstanceId: o.from.instanceId,
        toInstanceId: o.to.instanceId,
        text: clean(out.critiques[i]?.text ?? '', 48),
      }))
      .filter((c) => c.text);

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
        inspiredBy: toInspiration(r.inspiredBy, '', ctx),
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
    context?: ConsensusContext;
    spoken?: boolean;
  }): Promise<string | null> {
    const prompt = `${renderContext(input.theme, input.context)}

# 今回の依頼
あなたはキャラ「${input.characterName}」で、企画「${input.idea.title}」（${input.idea.summary.replace(/\n/g, ' ')}）をプレゼンしています。
審査員からの質問：「${input.question}」
キャラとして、質問に具体的に答えてください。100文字以内。企画の内容は変えずに説明する。合意している論点との関係に触れられるなら触れる。
- understood：質問の意味が通じるなら true。${input.spoken ? '声の文字起こしなので、' : ''}言葉が崩れていて何を聞いているのか分からない（聞き間違い・言葉の切れ端・つながらない単語の並び）ときは false にし、answer は空文字にする
- answer：understood が true のときの答え`;
    const out = await this.call('answer', this.config.fast, prompt, AnswerSchema);
    if (!out.understood || !out.answer.trim()) return null;
    return clean(out.answer, 140);
  }

  /**
   * 合意台帳の差分を作る（ADR-0007）。前の台帳と、その後の発言・行動だけを渡し、操作の列を返させる。
   * 状態（合意かどうか）はサーバーが賛否から計算するので、ここでは決めさせない。
   */
  async updateConsensus(input: ConsensusUpdateInput): Promise<ConsensusOpDraft[]> {
    const claims = input.claims.length
      ? input.claims
          .map((c) => `- ${c.label}［${c.status}］${c.text}（${c.stances.map((s) => `${s.judge}:${s.stance === 'support' ? '賛成' : '反対'}`).join('、') || '賛否なし'}）`)
          .join('\n')
      : '（まだ論点はありません）';
    const prompt = `# テーマ
${input.theme}
# 審査員
${input.judges.join('、')}
# いまの論点
${claims}

# 前回以降の発言（時系列）
${input.utterances.map((u) => `- seq ${u.seq}｜${u.judge}${u.target ? `（${u.target} に向けて）` : ''}${u.replyToClaim ? `（${u.replyToClaim} への返答）` : ''}：「${u.text}」`).join('\n') || '（なし）'}
# 前回以降の行動
${input.decisions.map((d) => `- ${d.judge ?? '自動'}：${DECISION_LABEL[d.kind] ?? d.kind}「${d.title}」`).join('\n') || '（なし）'}

# 今回の依頼
審査員がどんな方針・条件に賛成／反対しているかを、論点として台帳に記録する操作を出してください。
- add_claim：新しい方針・条件（例「実現コストは低く」「留学生も対象に」）。text は30文字以内の言い切り。言い出した人を judge、その人の賛否を stance に
- set_stance：既存の論点への賛成・反対（「いいね」「それは微妙」など、前の発言・論点への反応も含む）。label と judge と stance を入れる
- supersede：新しい論点が古い論点を置き換える場合（方針が変わった）。label に古い方、byLabel に新しい方（同じ回で add_claim した論点は C${nextLabelNumber(input)} から順に番号が振られる）
- 根拠は審査員（人間）の発言と行動だけ。AI キャラの答えや企画の中身、自分の推測から論点を作らない
- add_claim の text は、審査員が実際に言った内容の言い換えにとどめる。seq にその発言の番号を入れる（行動から作る場合は 0）
- 行動から論点を作ってよいのは、同じ審査員が同じ方向の案を2回以上選んだときだけ（judge はその人、stance は support）
- 反対（oppose）は、審査員がはっきり否定した（「それは微妙」「やめよう」など）か、案を見送った（不合格にした）ときだけ。選ばれなかった案があるだけでは反対にしない
- 単なる質問・雑談・個別の企画への感想や改良の頼みだけなら何も出さない（ops は空配列）
- 使わない項目は空文字、stance が無ければ none、seq が無ければ 0`;
    const out = await this.call('updateConsensus', this.config.fast, prompt, ConsensusSchema);
    const drafts: ConsensusOpDraft[] = [];
    const judges = new Set(input.judges);
    const spoke = new Set(input.utterances.map((u) => u.seq));
    const acted = new Set(input.decisions.map((d) => d.judge).filter((j): j is string => !!j));
    for (const o of out.ops) {
      const seq = o.seq > 0 && spoke.has(o.seq) ? o.seq : null;
      const judge = judges.has(o.judge.trim()) ? o.judge.trim() : null;
      if (o.op === 'add_claim' && o.text.trim()) {
        // 人の発言か行動に結び付かない論点は捨てる（AI の推測で合意・却下が増えないように）
        if (!judge || (seq === null && !acted.has(judge))) continue;
        drafts.push({ op: 'add_claim', text: clean(o.text, 40), judge, stance: o.stance === 'none' ? null : o.stance, seq });
      } else if (o.op === 'set_stance' && judge && o.stance !== 'none' && o.label.trim()) {
        drafts.push({ op: 'set_stance', label: o.label.trim(), judge, stance: o.stance, seq });
      } else if (o.op === 'supersede' && o.label.trim() && o.byLabel.trim()) {
        drafts.push({ op: 'supersede', label: o.label.trim(), byLabel: o.byLabel.trim() });
      }
    }
    return drafts;
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
        const usage = res.usageMetadata;
        this.log(
          `[ai] ${op} ok ${Date.now() - started}ms model=${profile.model} attempt=${attempt}` +
            (usage ? ` prompt=${usage.promptTokenCount ?? '?'} cached=${usage.cachedContentTokenCount ?? 0}` : ''),
        );
        return parsed.data;
      } catch (e) {
        lastError = e;
        this.log(`[ai] ${op} failed ${Date.now() - started}ms model=${profile.model} attempt=${attempt}: ${String(e)}`);
      }
    }
    throw lastError;
  }
}

const DECISION_LABEL: Record<string, string> = {
  promoted: '最終オーディションに選んだ',
  rejected: '見送った',
  timed_out: '（誰にも触れられず退場）',
  voted: '優勝候補として投票した',
  champion: '優勝に決めた',
};

function nextLabelNumber(input: ConsensusUpdateInput) {
  return input.nextClaimNumber;
}

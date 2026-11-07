import type { IdeaDraft, RevisionDraft } from '../../domain/types.ts';
import type { IdeaGenerationPort, RefineInput, RefineOutput } from '../../application/ports.ts';

/**
 * 外部 API なしで通しデモをするための固定データ（AC-33、ADR-0005 §1）。
 * 学食テーマの案は reference/mock-app/app/page.tsx から流用。
 */
const CAFETERIA_IDEAS: IdeaDraft[] = [
  ['サークル飯マップ', '同じ「好き」でつながる。\nサークルおすすめの学食を共有。', '♧'],
  ['混雑予測ナビ', 'もう、席探しに迷わない。\n空いている時間をAIがご案内。', '⌁'],
  ['世界の学食フェア', 'ランチで、世界を旅しよう。\n月替わりで楽しむ世界の料理。', '◎'],
  ['食べてポイント', 'いつものランチを、ごほうびに。\n学食を使うほど特典が貯まる。', '♧'],
  ['学食スタンプラリー', 'まだ知らない、おいしい発見。\n期間限定メニューを巡る冒険。', '♧'],
  ['AR食堂ツアー', 'スマホをかざして食堂探検。\nメニューの物語に出会える。', '◇'],
  ['学食パーソナライズ', 'あなたにぴったりの一皿。\n好みと栄養からAIがご提案。', '♡'],
  ['学食×コミュニティ', '「いただきます」で友達に。\n食の好みでつながる昼休み。', '♧'],
  ['おまかせランチくじ', '今日のお昼は運まかせ。\n新しいお気に入りを発見。', '✧'],
  ['推しメニュー総選挙', '次の限定メニューを決めよう。\nみんなの一票がおいしさに。', '☆'],
  ['もったいない定食', 'おいしく食べてロスを減らす。\n閉店前の限定セットを予約。', '♧'],
  ['ひとり飯ラウンジ', 'ひとりでも、心地いい。\n静かに過ごせる席を見つける。', '☾'],
  ['シェフの実験室', '学生のアイデアが一皿に。\n料理長と新メニューを開発。', '✧'],
  ['朝ごはんパスポート', '一日の始まりをおいしく。\nお得な朝食で生活リズムを。', '☀'],
  ['学食おすそわけ便', '忙しい友達に届けよう。\n昼ごはんの持ち帰り予約。', '◇'],
].map(([title, summary, icon]) => ({ title: title!, summary: summary!, icon: icon! }));

const GENERIC_PATTERNS: [string, string, string][] = [
  ['{t}スタンプラリー', '巡るほど楽しくなる。\n{t}を小さな冒険に。', '♧'],
  ['{t}マッチング', '同じ関心の人とつながる。\n{t}をきっかけに出会う。', '♡'],
  ['{t}ランキング', 'みんなの一票で決まる。\n{t}の「推し」を見える化。', '☆'],
  ['{t}おまかせくじ', '偶然の出会いを楽しむ。\n{t}を運まかせで体験。', '✧'],
  ['{t}ナビ', '迷わず、すぐ見つかる。\n{t}をAIが案内。', '⌁'],
  ['{t}ラボ', 'アイデアを持ち寄って試す。\n{t}をみんなで実験。', '◇'],
  ['{t}パスポート', '使うほど特典が増える。\n{t}を続けたくなる仕組み。', '◎'],
  ['{t}ナイトイベント', '夜だけの特別な時間。\n{t}をイベントで盛り上げる。', '☾'],
];

const CRITIQUES = [
  '実現コストをもう少し下げよう！',
  '対象をもっと絞ったほうが刺さりそう。',
  '続けて使いたくなる理由はある？',
  'その強み、こっちの案と組み合わせられるかも。',
  '最初の一歩を小さくすれば、すぐ試せそう！',
  '大学ならではの広がり方ができそう！',
  '体験の「ワクワク」をもっと前に出そう。',
  '運営する人の負担はどう減らす？',
];

const IMPROVEMENTS = [
  ['学内の限られた場所で小さく試す', '既存のメニュー情報を使い、初期費用を抑える'],
  ['対象を新入生に絞って参加のきっかけを作る', '参加特典で2回目の利用につなげる'],
  ['友達と一緒に参加できる仕組みを追加', '結果をSNSで共有しやすくする'],
  ['運営側の作業を週1回の更新だけにする', '学生スタッフと一緒に運営する'],
];

const SUMMARY_SUFFIX = [
  '\nまずは学内限定で、小さく始める。',
  '\n仲間と参加できて、続けたくなる。',
  '\n運営の手間を減らし、すぐ試せる。',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FixtureGateway implements IdeaGenerationPort {
  readonly name = 'fixture';
  private cursor = 0;

  constructor(private readonly latencyMs = 900) {}

  async generateIdeas(input: { theme: string; count: number; avoidTitles: string[] }): Promise<IdeaDraft[]> {
    await sleep(this.latencyMs * 0.5);
    const pool = /学食|食堂|ランチ/.test(input.theme) ? CAFETERIA_IDEAS : this.generic(input.theme);
    const out: IdeaDraft[] = [];
    for (let tries = 0; out.length < input.count && tries < pool.length * 2; tries++) {
      const idea = pool[this.cursor++ % pool.length]!;
      if (!input.avoidTitles.includes(idea.title) || tries >= pool.length) out.push({ ...idea });
    }
    return out;
  }

  async refine(input: RefineInput): Promise<RefineOutput> {
    await sleep(this.latencyMs * 1.6);
    const ps = input.participants;
    const critiques: RefineOutput['critiques'] = [];
    for (let r = 1; r <= input.rounds && ps.length > 1; r++) {
      const from = ps[(r - 1) % ps.length]!;
      const to = ps[r % ps.length]!;
      critiques.push({
        round: r,
        fromInstanceId: from.instanceId,
        toInstanceId: to.instanceId,
        text: CRITIQUES[(this.cursor++ + r) % CRITIQUES.length]!,
      });
    }
    const revisions: Record<string, RevisionDraft> = {};
    for (const p of ps.filter((x) => input.targets.includes(x.instanceId))) {
      const k = this.cursor++;
      const firstLine = p.summary.split('\n')[0] ?? p.summary;
      revisions[p.instanceId] = {
        title: p.version === 1 ? `${p.title}＋` : p.title.replace(/＋*$/, '＋'.repeat(Math.min(p.version, 3))),
        summary: firstLine + SUMMARY_SUFFIX[k % SUMMARY_SUFFIX.length]!,
        keepStrengths: [firstLine.replace(/[。、]$/, '')],
        improvementPoints: input.instruction
          ? [input.instruction, IMPROVEMENTS[k % IMPROVEMENTS.length]![0]!]
          : [...IMPROVEMENTS[k % IMPROVEMENTS.length]!],
        reason: input.instruction
          ? `審査員の指示「${input.instruction}」を反映`
          : input.trigger === 'arrival'
            ? '相互批評の指摘を反映'
            : '審査員が注目した強みを残し、実現性を高めた',
      };
    }
    return { critiques, revisions };
  }

  async answer(input: { idea: { title: string }; characterName: string; question: string }): Promise<string> {
    await sleep(this.latencyMs * 0.8);
    return `「${input.question}」への答え：${input.idea.title}は、まず1つの場所で2週間ためしてみて、参加した人の反応を集めます。専用の機材はいらないので、すぐに始められます！`;
  }

  private generic(theme: string): IdeaDraft[] {
    const t = theme.replace(/(を|の).*$/, '').slice(0, 8) || theme.slice(0, 8);
    return GENERIC_PATTERNS.map(([title, summary, icon]) => ({
      title: title.replace('{t}', t),
      summary: summary.replace('{t}', t),
      icon,
    }));
  }
}

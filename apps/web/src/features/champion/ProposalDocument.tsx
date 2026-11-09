import { CHARACTER_DESIGNS, PITCH_ROLE_ICON, TASTE_AXES, type ProposalContent, type SessionSnapshot } from '@idea-audition/protocol';
import { TasteRadar } from '../taste/TasteRadar.tsx';
import { Mascot } from '../../shared/Mascot.tsx';
import styles from './ProposalDocument.module.css';

export const PROPOSAL_PAGES = [
  { index: 0, part: '第1部：企画書', label: '概要・選ばれた理由', shortLabel: '1. 概要・選定理由' },
  { index: 1, part: '第1部：企画書', label: '主な内容・実行計画', shortLabel: '2. 内容・実行計画' },
  { index: 2, part: '第2部：審査レポート', label: '合意と好み分析', shortLabel: '3. 合意・好み分析' },
  { index: 3, part: '第2部：審査レポート', label: '改良の経緯・質疑', shortLabel: '4. 改良・質疑応答' },
] as const;

/**
 * PDF にする紙面（A4・全4ページ）。
 * 第1部（1〜2ページ目）は AI が作った企画書＋「何の案で、なぜ選ばれたか」の視覚サマリー。
 * 第2部（3〜4ページ目）は審査の記録からそのまま作るレポート（LLM を通さない事実記録）。
 * page を指定するとそのページだけを描画し、省略すると全ページを順番に描画する。
 */
export function ProposalDocument({
  snapshot,
  content,
  page,
  preview = false,
}: {
  snapshot: SessionSnapshot;
  content: ProposalContent;
  /** 表示するページ番号（0〜3）。省略時は全ページを描画（PDF出力用） */
  page?: number;
  /** 画面内ビューア用のレスポンシブ表示にするか */
  preview?: boolean;
}) {
  const champ = snapshot.champion!;
  const character = snapshot.characters[champ.instanceId]!;
  const idea = snapshot.ideas[champ.ideaId]!;
  const revisions = idea.revisions;
  const champRev = revisions.find((r) => r.revisionId === champ.revisionId) ?? revisions[revisions.length - 1]!;
  const firstRev = revisions[0]!;
  const outline = champRev.outline ?? firstRev.outline ?? null;

  const judgeLabel = (id: string | null) => snapshot.judges.find((j) => j.judgeId === id)?.label ?? '—';
  const nameOf = (id: string) => snapshot.characters[id]?.name ?? 'AI';
  const designOf = (id: string) => snapshot.characters[id]?.designId ?? 0;
  const titleOf = (instanceId: string) => {
    const c = snapshot.characters[instanceId];
    const i = c ? snapshot.ideas[c.ideaId] : undefined;
    return i ? i.revisions[i.revisions.length - 1]!.title : '—';
  };
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  const claims = snapshot.consensus.claims;
  const agreed = claims.filter((c) => c.status === 'agreed');
  const others = claims.filter((c) => c.status !== 'agreed');
  const critiques = snapshot.critiques.filter((c) => c.fromInstanceId === champ.instanceId || c.toInstanceId === champ.instanceId);
  const qa = snapshot.answers.filter((a) => a.instanceId === champ.instanceId && a.answer);
  const finalists = snapshot.upper.length > 0 ? snapshot.upper.map((f) => f.instanceId) : [champ.instanceId];
  const rejected = snapshot.ideaBox.filter((x) => x.reason === 'rejected');
  const timedOut = snapshot.ideaBox.filter((x) => x.reason !== 'rejected');
  const tally = snapshot.vote?.tally ?? null;
  const ideaTitle = (ideaId: string) => {
    const i = snapshot.ideas[ideaId];
    return i ? i.revisions[i.revisions.length - 1]!.title : '—';
  };
  const totalIdeas = Object.keys(snapshot.ideas).length;
  const stats = [
    ['検討した案', totalIdeas],
    ['最終オーディション', finalists.length],
    ['見送り', rejected.length],
    ['時間切れで退場', timedOut.length],
    ['改良の回数', Math.max(0, revisions.length - 1)],
    ['合意した方針', agreed.length],
  ] as const;

  const showPage = (idx: number) => page === undefined || page === idx;
  const totalPages = PROPOSAL_PAGES.length;
  const whyReasons =
    agreed.length > 0
      ? agreed.slice(0, 3).map((c) => `${c.label}：${c.text}`)
      : champRev.keepStrengths.length > 0
        ? champRev.keepStrengths.slice(0, 3)
        : [content.value];
  const whyImprovements =
    champRev.improvementPoints.length > 0
      ? champRev.improvementPoints.slice(0, 3)
      : content.features.slice(0, 2).map((f) => `${f.name}：${f.detail}`);

  return (
    <div className={styles.doc} data-preview={preview || undefined}>
      {/* ======================= 1ページ目：企画書①（概要・選ばれた理由） ======================= */}
      {showPage(0) && (
        <article className={styles.page} data-page={1}>
          <header className={styles.cover}>
            <div className={styles.topRow}>
              <div className={styles.brand}>IDEA AUDITION · 企画書</div>
              <span className={styles.pageBadge}>1 / {totalPages} · 企画概要</span>
            </div>
            <div className={styles.coverRow}>
              <div className={styles.coverMain}>
                <div className={styles.badgeRow}>
                  <span className={styles.themeBadge}>テーマ：{snapshot.theme}</span>
                  <span className={styles.winBadge}>CHAMPION · Ver.{champRev.version}（全{revisions.length}版）</span>
                </div>
                <h1>{content.title}</h1>
                <p className={styles.catch}>{content.catchphrase}</p>
                <p className={styles.meta}>
                  作成：{date(snapshot.proposal?.generatedAt ?? null)} ／ 発案：{character.name} ／ 審査員：
                  {snapshot.judges.map((j) => j.label).join('・') || '—'}
                </p>
              </div>
              <div className={styles.mascotBox}>
                <span className={styles.mascotCrown}>👑 WINNER</span>
                <Mascot designId={character.designId} className={styles.mascot} />
                <strong className={styles.mascotCaption}>{character.name}</strong>
              </div>
            </div>
          </header>

          {/* AI生成の企画イメージ図（キービジュアル） */}
          {content.imageUrl && (
            <figure className={styles.keyVisual} data-keep>
              <div className={styles.keyVisualFrame}>
                <img
                  src={content.imageUrl}
                  alt={`${content.title} の企画イメージ`}
                  className={styles.keyVisualImg}
                  data-proposal-visual="true"
                />
                <span className={styles.keyVisualBadge}>AI CONCEPT VISUAL · 企画イメージ図</span>
              </div>
              <figcaption className={styles.keyVisualCaption}>
                <strong>利用シーン・世界観：</strong>
                {content.catchphrase}（対象：{outline?.who ?? content.target}）
              </figcaption>
            </figure>
          )}

          {/* 図解：何の案か（誰の・どんな課題を・どう解くか） */}
          <div className={styles.conceptFlow} data-keep>
            <div className={styles.conceptCard}>
              <div className={styles.conceptHead}>
                <ConceptIcon kind="who" />
                <span>01 · 誰のための企画か</span>
              </div>
              <p>{outline?.who ?? content.target}</p>
            </div>
            <div className={styles.conceptArrow} aria-hidden>
              →
            </div>
            <div className={styles.conceptCard}>
              <div className={styles.conceptHead}>
                <ConceptIcon kind="pain" />
                <span>02 · 解決したい課題</span>
              </div>
              <p>{outline?.pain ?? content.problem}</p>
            </div>
            <div className={styles.conceptArrow} aria-hidden>
              →
            </div>
            <div className={styles.conceptCard} data-highlight="true">
              <div className={styles.conceptHead}>
                <ConceptIcon kind="how" />
                <span>03 · どう解くか（価値）</span>
              </div>
              <p>{outline?.how ?? content.value}</p>
            </div>
          </div>

          {/* なぜこの案が選ばれたか（1ページ目で直感的に分かる選定理由ボックス） */}
          <section className={styles.whyBox} data-keep>
            <div className={styles.whyHeader}>
              <span className={styles.whyTitle}>🏆 なぜこの案が選ばれたか（選定の決め手）</span>
              <div className={styles.whyChips}>
                <span>全 {totalIdeas} 案から選出</span>
                <span>
                  {tally
                    ? `最終投票 ${tally[champ.instanceId] ?? 0} 票で1位`
                    : snapshot.mode === 'solo'
                      ? '単独審査で選出'
                      : '最終オーディションで選出'}
                </span>
                <span>改良 {Math.max(0, revisions.length - 1)} 回</span>
                <span>合意 {agreed.length} 件を反映</span>
              </div>
            </div>
            <div className={styles.whyGrid}>
              <div className={styles.whyCol}>
                <div className={styles.whyColTitle}>🤝 審査で合意した方針・評価された強み</div>
                <ul className={styles.whyList}>
                  {whyReasons.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
                {idea.pitch && (
                  <p className={styles.whyPitch}>
                    {PITCH_ROLE_ICON[idea.pitch.role]} 登場の狙い：{idea.pitch.reason}
                  </p>
                )}
              </div>
              <div className={styles.whyCol}>
                <div className={styles.whyColTitle}>✨ 決勝までに磨かれた改善ポイント</div>
                <ul className={styles.whyList}>
                  {whyImprovements.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
                {champRev.reason && <p className={styles.whyPitch}>直近の改良理由：{champRev.reason}</p>}
              </div>
            </div>
          </section>

          <div className={styles.twoCol} data-keep>
            <Section title="背景">{content.background}</Section>
            <Section title="解決したい課題">{content.problem}</Section>
          </div>
          <div className={styles.twoCol} data-keep>
            <Section title="対象者">{content.target}</Section>
            <Section title="提供する価値">{content.value}</Section>
          </div>
          <Section title="企画の概要">{content.overview}</Section>

          <PageFooter page={1} total={totalPages} title={content.title} part="第1部：企画書" />
        </article>
      )}

      {page === undefined && <div className={styles.pageBreak} />}

      {/* ======================= 2ページ目：企画書②（主な内容・実行計画） ======================= */}
      {showPage(1) && (
        <article className={styles.page} data-page={2}>
          <header className={styles.subHeader}>
            <div>
              <div className={styles.brand}>IDEA AUDITION · 企画書</div>
              <strong className={styles.subHeaderTitle}>{content.title} — 主な内容と実行計画</strong>
            </div>
            <div className={styles.subHeaderRight}>
              <Mascot designId={character.designId} className={styles.subMascot} />
              <span className={styles.pageBadge}>2 / {totalPages} · 実行計画</span>
            </div>
          </header>

          <h2 className={styles.h2}>主な内容</h2>
          <div className={styles.featureCards} data-keep>
            {content.features.map((f, i) => (
              <div key={i} className={`${styles.featureCard} ${styles.avoid}`}>
                <div className={styles.featureBadge}>{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <strong>{f.name}</strong>
                  <p>{f.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <table className={styles.table}>
            <tbody>
              {content.features.map((f, i) => (
                <tr key={i} className={styles.avoid}>
                  <th>{f.name}</th>
                  <td>{f.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className={styles.h2}>進め方</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>段階</th>
                <th>期間（目安）</th>
                <th>やること</th>
              </tr>
            </thead>
            <tbody>
              {content.plan.map((p, i) => (
                <tr key={i} className={styles.avoid}>
                  <td>
                    <span className={styles.stepPill}>STEP {i + 1}</span> {p.phase}
                  </td>
                  <td className={styles.nowrap}>{p.period}</td>
                  <td>{p.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.twoCol} data-keep>
            <Section title="体制">{content.resources}</Section>
            <Section title="予算の目安">{content.budget}</Section>
          </div>

          <h2 className={styles.h2}>リスクと対策</h2>
          <table className={styles.table}>
            <tbody>
              {content.risks.map((r, i) => (
                <tr key={i} className={styles.avoid}>
                  <th>⚠️ {r.risk}</th>
                  <td>🛡️ {r.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.twoCol} data-keep>
            <ListSection title="成果の測り方" items={content.kpis} />
            <ListSection title="次の一手" items={content.nextActions} />
          </div>
          <ListSection title="要検証の前提" items={content.assumptions} tone="warn" />

          <PageFooter page={2} total={totalPages} title={content.title} part="第1部：企画書" />
        </article>
      )}

      {page === undefined && <div className={styles.pageBreak} />}

      {/* ======================= 3ページ目：審査レポート①（合意と好み分析） ======================= */}
      {showPage(2) && (
        <article className={styles.page} data-page={3}>
          <header className={styles.partHeader}>
            <div className={styles.topRow}>
              <div className={styles.brand}>IDEA AUDITION · 審査レポート</div>
              <span className={styles.pageBadge}>3 / {totalPages} · 合意と好み分析</span>
            </div>
            <h1>この企画に決まるまで</h1>
            <p className={styles.meta}>
              {date(snapshot.startedAt)} 〜 ／ テーマ：{snapshot.theme} ／ 審査員：{snapshot.judges.map((j) => j.label).join('・')}（
              {snapshot.mode === 'solo' ? 'ひとりで審査' : 'みんなで審査'}）
            </p>
            {/* 最後のページに注記だけが残らないよう、第2部の頭に置く */}
            <p className={styles.footer}>
              第1部の企画書は、審査の記録をもとに {authorLabel(snapshot.proposal?.generatedBy)} が作成した案です。「要検証の前提」を確認してから進めてください。第2部は審査中の記録をそのまま載せています。
            </p>
          </header>

          <div className={styles.stats} data-keep>
            {stats.map(([label, value]) => (
              <div key={label}>
                <b>{value}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* 最終オーディションに残った案のキャラクター比較カード */}
          <h2 className={styles.h2}>最終オーディションに残った案</h2>
          <div className={styles.finalistGrid} data-keep>
            {finalists.map((fid) => {
              const fc = snapshot.characters[fid];
              const fi = fc ? snapshot.ideas[fc.ideaId] : undefined;
              const frev = fi?.revisions[fi.revisions.length - 1];
              const isWinner = fid === champ.instanceId;
              const votes = tally ? (tally[fid] ?? 0) : null;
              if (!fc || !frev) return null;
              return (
                <div key={fid} className={styles.finalistCard} data-winner={isWinner || undefined}>
                  <Mascot designId={fc.designId} className={styles.finalistMascot} />
                  <div className={styles.finalistBody}>
                    <div className={styles.finalistMeta}>
                      <strong>{fc.name}</strong>
                      <span>Ver.{frev.version}</span>
                      {votes !== null && <span>{votes}票</span>}
                      {isWinner && <span className={styles.winnerTag}>👑 優勝</span>}
                    </div>
                    <div className={styles.finalistTitle}>{frev.title}</div>
                    <p className={styles.finalistSummary}>{frev.summary.replace(/\n/g, ' ')}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className={styles.h2}>審査で合意した方針</h2>
          {agreed.length === 0 ? (
            <p className={styles.muted}>合意として記録された方針はありません。</p>
          ) : (
            agreed.map((c) => (
              <div key={c.label} className={`${styles.claim} ${styles.avoid}`} data-keep>
                <b>{c.label}</b> {c.text}
                {c.pinned && <span className={styles.tag}>確定</span>}
                <div className={styles.timeline}>
                  {c.history.map((h, i) => (
                    <span key={i}>
                      {time(h.at)} {judgeLabel(h.judgeId)} {h.stance === 'support' ? '賛成' : '反対'}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
          {others.length > 0 && (
            <p className={styles.muted}>
              合意に至らなかった論点：
              {others
                .map((c) => `${c.label}「${c.text}」（${c.status === 'superseded' ? `${c.supersededBy} に置き換え` : c.status === 'rejected' ? '却下' : '提案のまま'}）`)
                .join('、')}
            </p>
          )}

          <TasteReport snapshot={snapshot} />

          <PageFooter page={3} total={totalPages} title={content.title} part="第2部：審査レポート" />
        </article>
      )}

      {page === undefined && <div className={styles.pageBreak} />}

      {/* ======================= 4ページ目：審査レポート②（改良の経緯・質疑） ======================= */}
      {showPage(3) && (
        <article className={styles.page} data-page={4}>
          <header className={styles.subHeader}>
            <div>
              <div className={styles.brand}>IDEA AUDITION · 審査レポート</div>
              <strong className={styles.subHeaderTitle}>{content.title} — 改良の経緯と質疑の記録</strong>
            </div>
            <div className={styles.subHeaderRight}>
              <Mascot designId={character.designId} className={styles.subMascot} />
              <span className={styles.pageBadge}>4 / {totalPages} · 改良と質疑</span>
            </div>
          </header>

          <h2 className={styles.h2}>改良の経緯</h2>
          {revisions.map((r) => (
            <div key={r.revisionId} className={`${styles.rev} ${styles.avoid}`} data-keep>
              <div className={styles.revHead}>
                <Mascot designId={character.designId} className={styles.tinyMascot} />
                <b>Ver.{r.version}</b> {r.title}
                <span>{time(r.createdAt)}</span>
              </div>
              <p>{r.summary.replace(/\n/g, ' ')}</p>
              {r.reason && <p className={styles.muted}>変えた理由：{r.reason}</p>}
              {r.improvementPoints.length > 0 && <p className={styles.muted}>改善：{r.improvementPoints.join('／')}</p>}
              {r.inspiredBy && <p className={styles.muted}>💡 {r.inspiredBy.note}（{r.inspiredBy.claimLabels.join('・')}）</p>}
            </div>
          ))}

          {critiques.length > 0 && (
            <>
              <h2 className={styles.h2}>最終オーディションでの相互批評</h2>
              <ul className={styles.critiqueList}>
                {critiques.map((c) => (
                  <li key={c.critiqueId} className={styles.avoid}>
                    <Mascot designId={designOf(c.fromInstanceId)} className={styles.tinyMascot} />
                    <span>
                      <b>{nameOf(c.fromInstanceId)}</b> → <b>{nameOf(c.toInstanceId)}</b>：{c.text}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {qa.length > 0 && (
            <>
              <h2 className={styles.h2}>審査員からの質問と回答</h2>
              {qa.map((a) => (
                <div key={a.answerId} className={`${styles.qa} ${styles.avoid}`}>
                  <b>Q（{judgeLabel(a.judgeId)}）</b> {a.question}
                  <p>
                    <Mascot designId={character.designId} className={styles.tinyMascot} />
                    <span>A：{a.answer}</span>
                  </p>
                </div>
              ))}
            </>
          )}

          <h2 className={styles.h2}>決め方</h2>
          {tally ? (
            <table className={styles.table}>
              <tbody>
                {Object.entries(tally)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, votes]) => (
                    <tr key={id}>
                      <th>{titleOf(id)}</th>
                      <td>
                        {votes} 票{id === champ.instanceId ? '（優勝）' : ''}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p>{snapshot.mode === 'solo' ? 'ひとりで審査し、優勝を選びました。' : '最終オーディションの案から、ホストが優勝を選びました。'}</p>
          )}
          {finalists.length > 1 && (
            <p className={styles.muted}>
              一緒に最終オーディションに残った案：
              {finalists
                .filter((id) => id !== champ.instanceId)
                .map(titleOf)
                .join('、')}
            </p>
          )}

          {snapshot.ideaBox.length > 0 && (
            <>
              <h2 className={styles.h2}>見送った・入れ替わった案（{snapshot.ideaBox.length}件）</h2>
              <div className={styles.archivedGrid} data-keep>
                {snapshot.ideaBox.map((x) => {
                  const design = CHARACTER_DESIGNS[x.designId] ?? CHARACTER_DESIGNS[0]!;
                  return (
                    <span key={x.ideaId} className={styles.archivedChip}>
                      <Mascot designId={design.designId} className={styles.tinyMascot} />
                      <span>
                        {ideaTitle(x.ideaId)}（{x.reason === 'rejected' ? '見送り' : '時間切れ'}）
                      </span>
                    </span>
                  );
                })}
              </div>
            </>
          )}

          <PageFooter page={4} total={totalPages} title={content.title} part="第2部：審査レポート" />
        </article>
      )}
    </div>
  );
}

function ConceptIcon({ kind }: { kind: 'who' | 'pain' | 'how' }) {
  if (kind === 'who') {
    return (
      <svg className={styles.conceptIcon} viewBox="0 0 24 24" fill="none" stroke="#7a3fc8" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="8" r="4" fill="#f2e9fc" />
        <path d="M4 20c1.8-4 5-6 8-6s6.2 2 8 6" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'pain') {
    return (
      <svg className={styles.conceptIcon} viewBox="0 0 24 24" fill="none" stroke="#c25900" strokeWidth="2" aria-hidden>
        <polygon points="12,3 22,20 2,20" fill="#fff2e2" strokeLinejoin="round" />
        <line x1="12" y1="9" x2="12" y2="14" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1" fill="#c25900" />
      </svg>
    );
  }
  return (
    <svg className={styles.conceptIcon} viewBox="0 0 24 24" fill="none" stroke="#1f7a52" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="11" r="6" fill="#e6f9f0" />
      <path d="M9.5 19h5M10.5 22h3" strokeLinecap="round" />
      <path d="M12 2v2M4.9 4.9l1.4 1.4M19.1 4.9l-1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

function PageFooter({ page, total, title, part }: { page: number; total: number; title: string; part: string }) {
  return (
    <footer className={styles.pageFooter}>
      <span>
        IDEA AUDITION · {part} — {title}
      </span>
      <strong>
        {page} / {total}
      </strong>
    </footer>
  );
}

const ROLE_LABEL: Record<string, string> = {
  fit: '好みに寄せた案',
  bridge: '2人の間をとる案',
  explore: 'まだ出ていない方向の案',
  wildcard: 'ワイルドカード',
};
const pct = (picked: number, shown: number) => (shown === 0 ? '—' : `${Math.round((picked / shown) * 100)}%`);

/**
 * 好みの読み取りと効果（ADR-0009 の証拠）。記録から数えるだけで、LLM は通さない。
 * 「後半に出た案ほど選ばれた」なら、反応から好みを読んで出し方を変えたことが効いている。
 */
function TasteReport({ snapshot }: { snapshot: SessionSnapshot }) {
  const { metrics, taste, judges } = snapshot;
  const active = judges.filter((j) => (taste.signals[j.judgeId] ?? 0) > 0);
  const roles = Object.entries(metrics.byRole).filter(([, v]) => v.shown > 0);
  if (active.length === 0 && metrics.firstHalf.shown + metrics.secondHalf.shown === 0) return null;
  const label = (id: string) => judges.find((j) => j.judgeId === id)?.label ?? '審査員';
  return (
    <>
      <h2 className={styles.h2}>好みの読み取りと効果</h2>
      <div className={`${styles.taste} ${styles.avoid}`}>
        <TasteRadar snapshot={snapshot} print />
        <div>
          {active.map((j) => {
            const v = taste.judges[j.judgeId]!;
            const top = v
              .map((x, i) => ({ x, i }))
              .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
              .slice(0, 2)
              .filter((t) => Math.abs(t.x) >= 0.2)
              .map((t) => `${TASTE_AXES[t.i]!.label}${t.x > 0 ? '高め' : '控えめ'}`);
            return (
              <p key={j.judgeId} className={styles.small}>
                <b style={{ color: j.color }}>●</b> {j.label}：{top.join('・') || '偏りなし'}（反応 {taste.signals[j.judgeId]} 回）
              </p>
            );
          })}
          {taste.divergence && (
            <p className={styles.small}>
              {label(taste.divergence.judgeA)}と{label(taste.divergence.judgeB)}は「{TASTE_AXES[taste.divergence.axis]!.label}」で好みが割れていたため、間をとる案を混ぜて出しました。
            </p>
          )}
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>下段に出た案</th>
            <th>出た数</th>
            <th>決勝に選ばれた数</th>
            <th>選ばれた率</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>前半</th>
            <td>{metrics.firstHalf.shown}</td>
            <td>{metrics.firstHalf.picked}</td>
            <td>{pct(metrics.firstHalf.picked, metrics.firstHalf.shown)}</td>
          </tr>
          <tr>
            <th>後半（好みを読んでから）</th>
            <td>{metrics.secondHalf.shown}</td>
            <td>{metrics.secondHalf.picked}</td>
            <td>{pct(metrics.secondHalf.picked, metrics.secondHalf.shown)}</td>
          </tr>
          {roles.map(([role, v]) => (
            <tr key={role}>
              <th>
                {PITCH_ROLE_ICON[role as keyof typeof PITCH_ROLE_ICON]} {ROLE_LABEL[role] ?? role}
              </th>
              <td>{v.shown}</td>
              <td>{v.picked}</td>
              <td>{pct(v.picked, v.shown)}</td>
            </tr>
          ))}
          {metrics.revisions.shown > 0 && (
            <tr>
              <th>🤔 迷いを受けて出した別案</th>
              <td>{metrics.revisions.shown}</td>
              <td>{metrics.revisions.picked}</td>
              <td>{pct(metrics.revisions.picked, metrics.revisions.shown)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={styles.muted}>
        {metrics.liftPct === null
          ? `前半と後半の比較には、それぞれ4案以上が出て3案以上が選ばれている必要があります（今回は前半 ${metrics.firstHalf.picked} 件・後半 ${metrics.secondHalf.picked} 件が選ばれたので、件数だけ示します）。`
          : `後半に出た案は、前半より決勝に選ばれた率が ${metrics.liftPct >= 0 ? `${metrics.liftPct}% 高く` : `${-metrics.liftPct}% 低く`}なりました。`}
        1回のセッションの数字なので、偶然の影響を含みます。
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section} data-keep>
      <h2 className={styles.h2}>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

function ListSection({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  return (
    <section className={styles.section} data-tone={tone} data-keep>
      <h2 className={styles.h2}>{title}</h2>
      <ul className={styles.list}>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

/** 企画書を書いたものの表示名（内部の名前 gemini(fallback:fixture) などは見せない） */
function authorLabel(generatedBy: string | null | undefined) {
  if (!generatedBy) return 'AI';
  if (generatedBy.startsWith('gemini')) return 'AI（Gemini）';
  if (generatedBy.startsWith('fixture')) return '固定データ';
  return 'AI';
}

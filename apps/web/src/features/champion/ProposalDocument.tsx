import { PITCH_ROLE_ICON, TASTE_AXES, type ProposalContent, type SessionSnapshot } from '@idea-audition/protocol';
import { TasteRadar } from '../taste/TasteRadar.tsx';
import { Mascot } from '../../shared/Mascot.tsx';
import styles from './ProposalDocument.module.css';

/**
 * PDF にする紙面（A4）。第1部は AI が作った企画書、第2部は審査の記録からそのまま作るレポート。
 * 第2部は LLM を通さないので、書いてあることはすべて実際に審査中に起きたこと。
 */
export function ProposalDocument({ snapshot, content }: { snapshot: SessionSnapshot; content: ProposalContent }) {
  const champ = snapshot.champion!;
  const character = snapshot.characters[champ.instanceId]!;
  const idea = snapshot.ideas[champ.ideaId]!;
  const revisions = idea.revisions;
  const judgeLabel = (id: string | null) => snapshot.judges.find((j) => j.judgeId === id)?.label ?? '—';
  const nameOf = (id: string) => snapshot.characters[id]?.name ?? 'AI';
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
  const finalists = snapshot.upper.map((f) => f.instanceId);
  const rejected = snapshot.ideaBox.filter((x) => x.reason === 'rejected');
  const timedOut = snapshot.ideaBox.filter((x) => x.reason !== 'rejected');
  const tally = snapshot.vote?.tally ?? null;
  const ideaTitle = (ideaId: string) => {
    const i = snapshot.ideas[ideaId];
    return i ? i.revisions[i.revisions.length - 1]!.title : '—';
  };
  const stats = [
    ['検討した案', Object.keys(snapshot.ideas).length],
    ['最終オーディション', finalists.length],
    ['見送り', rejected.length],
    ['時間切れで退場', timedOut.length],
    ['改良の回数', revisions.length - 1],
    ['合意した方針', agreed.length],
  ] as const;

  return (
    <div className={styles.doc}>
      {/* ------------------------------ 第1部 企画書 ------------------------------ */}
      <header className={styles.cover}>
        <div className={styles.brand}>IDEA AUDITION · 企画書</div>
        <div className={styles.coverRow}>
          <div>
            <h1>{content.title}</h1>
            <p className={styles.catch}>{content.catchphrase}</p>
            <p className={styles.meta}>
              テーマ：{snapshot.theme}
              <br />
              作成：{date(snapshot.proposal?.generatedAt ?? null)} ／ 発案：{character.name}
            </p>
          </div>
          <Mascot designId={character.designId} className={styles.mascot} />
        </div>
      </header>

      <Section title="背景">{content.background}</Section>
      <Section title="解決したい課題">{content.problem}</Section>
      <div className={styles.twoCol} data-keep>
        <Section title="対象者">{content.target}</Section>
        <Section title="提供する価値">{content.value}</Section>
      </div>
      <Section title="企画の概要">{content.overview}</Section>

      <h2 className={styles.h2}>主な内容</h2>
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
              <td>{p.phase}</td>
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
              <th>{r.risk}</th>
              <td>{r.mitigation}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.twoCol} data-keep>
        <ListSection title="成果の測り方" items={content.kpis} />
        <ListSection title="次の一手" items={content.nextActions} />
      </div>
      <ListSection title="要検証の前提" items={content.assumptions} tone="warn" />

      {/* ---------------------------- 第2部 審査レポート ---------------------------- */}
      <div className={styles.pageBreak} />
      <header className={styles.partHeader}>
        <div className={styles.brand}>IDEA AUDITION · 審査レポート</div>
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

      <h2 className={styles.h2}>改良の経緯</h2>
      {revisions.map((r) => (
        <div key={r.revisionId} className={`${styles.rev} ${styles.avoid}`} data-keep>
          <div className={styles.revHead}>
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
          <ul className={styles.list}>
            {critiques.map((c) => (
              <li key={c.critiqueId}>
                {nameOf(c.fromInstanceId)} → {nameOf(c.toInstanceId)}：{c.text}
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
              <p>A：{a.answer}</p>
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
          <p className={styles.small}>
            {snapshot.ideaBox
              .map((x) => `${ideaTitle(x.ideaId)}（${x.reason === 'rejected' ? '見送り' : '時間切れ'}）`)
              .join('、')}
          </p>
        </>
      )}

    </div>
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

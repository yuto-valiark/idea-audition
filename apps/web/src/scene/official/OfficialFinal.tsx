import { Check, FileText, Loader2, MessageSquare, Vote } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { currentRevision, useMe } from '../../shared/selectors.ts';
import { proposalLetter } from '../../shared/proposal-label.ts';
import { OfficialAgenda } from './OfficialAgenda.tsx';
import { QA } from './QA.tsx';
import styles from './Official.module.css';

/**
 * オフィシャル会議モードの決勝（最終審議）。採択候補を A案・B案… の列にした比較表。
 * 列ごとに「詳細・質問」「議論する（全員で注目＝スポットライト）」、採決中は「投票」。
 * 中身は決勝と同じ：相互批評と改良で版が進み、投票（同票はホスト）で採択を決める
 */
export function OfficialFinal() {
  const snapshot = useSession((s) => s.snapshot)!;
  const ids = snapshot.upper.map((f) => f.instanceId);
  return (
    <div className={styles.meeting}>
      <OfficialAgenda phase={1} right={<BallotStatus snapshot={snapshot} />} />
      <div className={styles.body} data-wide>
        <main className={styles.main}>
          <SpotlightNote snapshot={snapshot} />
          <div className={styles.compareWrap}>
            <table className={styles.compare} style={{ '--cols': ids.length } as CSSProperties}>
              <thead>
                <tr>
                  <th aria-hidden />
                  {ids.map((id) => (
                    <CandidateHead key={id} snapshot={snapshot} instanceId={id} />
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="概要" ids={ids} cell={(id) => currentRevision(snapshot, id)?.summary} />
                <Row label="対象" ids={ids} cell={(id) => currentRevision(snapshot, id)?.outline?.who} />
                <Row label="課題" ids={ids} cell={(id) => currentRevision(snapshot, id)?.outline?.pain} />
                <Row label="解決策" ids={ids} cell={(id) => currentRevision(snapshot, id)?.outline?.how} />
                <Row
                  label="この版での変更"
                  ids={ids}
                  cell={(id) => {
                    const r = currentRevision(snapshot, id);
                    return r && r.version > 1 && r.improvementPoints.length ? (
                      <ul>
                        {r.improvementPoints.slice(0, 3).map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    ) : null;
                  }}
                />
                <Row
                  label="反映した合意"
                  ids={ids}
                  cell={(id) => {
                    const labels = currentRevision(snapshot, id)?.inspiredBy?.claimLabels ?? [];
                    const texts = labels.map((l) => snapshot.consensus.claims.find((c) => c.label === l)?.text).filter((t): t is string => !!t);
                    return texts.length ? (
                      <ul>
                        {texts.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    ) : null;
                  }}
                />
                <Row
                  label="質疑応答"
                  ids={ids}
                  cell={(id) => (snapshot.answers.some((a) => a.instanceId === id) ? <QA snapshot={snapshot} instanceId={id} limit={1} /> : null)}
                />
                <Row
                  label="批評"
                  ids={ids}
                  cell={(id) => (snapshot.critiques.some((c) => c.toInstanceId === id) ? <LatestCritique snapshot={snapshot} instanceId={id} /> : null)}
                />
              </tbody>
              <tfoot>
                <tr>
                  <th aria-hidden />
                  {ids.map((id) => (
                    <td key={id}>
                      <Decide snapshot={snapshot} instanceId={id} />
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

function Row({ label, ids, cell }: { label: string; ids: string[]; cell: (id: string) => React.ReactNode }) {
  const cells = ids.map((id) => cell(id));
  if (cells.every((c) => c == null || c === '')) return null;
  return (
    <tr>
      <th scope="row">{label}</th>
      {ids.map((id, i) => (
        <td key={id}>{cells[i] ?? <span className={styles.muted}>—</span>}</td>
      ))}
    </tr>
  );
}

const BUSY = { refining: '改良中', critiquing: '批評中', ready: '' } as const;

/** 列の見出し：記号・案名・版・状態、詳細・質問と、議論する（全員で注目） */
function CandidateHead({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const { isSpectator } = useMe();
  const revision = currentRevision(snapshot, instanceId);
  const finalist = snapshot.upper.find((f) => f.instanceId === instanceId);
  if (!revision || !finalist) return <th />;
  const letter = proposalLetter(snapshot, instanceId);
  const spot = snapshot.spotlight?.instanceId === instanceId;
  const answering = snapshot.answers.some((a) => a.instanceId === instanceId && a.answer === null);
  const busy = BUSY[finalist.status] || (answering ? '回答中' : '');
  return (
    <th scope="col" data-spot={spot || undefined}>
      <div className={styles.candHead}>
        <span className={styles.letter}>{letter}案</span>
        <span className={styles.version}>
          版 {revision.version}
          {busy && (
            <em>
              <Loader2 size={11} className={styles.spin} /> {busy}
            </em>
          )}
        </span>
      </div>
      <div className={styles.candTitle}>{revision.title}</div>
      <div className={styles.candActions}>
        <button className={styles.linkButton} onClick={() => select(instanceId)}>
          <FileText size={14} /> 詳細・質問
        </button>
        {!isSpectator && (
          <button className={styles.linkButton} data-on={spot || undefined} onClick={() => void send('SET_SPOTLIGHT', { instanceId: spot ? null : instanceId })}>
            <MessageSquare size={14} /> {spot ? '議論を終える' : '議論する'}
          </button>
        )}
      </div>
    </th>
  );
}

/** いちばん新しい相互批評（その案が受けたもの） */
function LatestCritique({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const c = [...snapshot.critiques].reverse().find((x) => x.toInstanceId === instanceId);
  if (!c) return null;
  const from = proposalLetter(snapshot, c.fromInstanceId);
  return (
    <p className={styles.critique}>
      {from && <b>{from}案より：</b>}
      {c.text}
    </p>
  );
}

/** いま議論している案（スポットライト）。名前を言わない質問はこの案に向く */
function SpotlightNote({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const id = snapshot.spotlight?.instanceId;
  if (!id) return null;
  const letter = proposalLetter(snapshot, id);
  const title = currentRevision(snapshot, id)?.title;
  return (
    <div className={styles.notice} role="status">
      <MessageSquare size={15} /> 議論中：<b>{letter}案</b> {title}
      <button onClick={() => void send('SET_SPOTLIGHT', { instanceId: null })}>終える</button>
    </div>
  );
}

/** 列の下：採決中は投票、同票はホストが決定、1案だけ・ひとりで審査ならホストがそのまま採択 */
function Decide({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const send = useSession((s) => s.send);
  const { isHost, isSpectator } = useMe();
  const myVote = useDisplay((s) => s.myVote);
  const setMyVote = useDisplay((s) => s.setMyVote);
  const vote = snapshot.vote;
  if (isSpectator) return null;
  if (vote?.status === 'open') {
    const chosen = myVote === instanceId;
    return (
      <button
        className={chosen ? styles.primary : styles.secondary}
        aria-pressed={chosen}
        onClick={async () => {
          if (chosen) return;
          const r = await send('CAST_VOTE', { instanceId });
          if (r.ok) setMyVote(instanceId);
        }}
      >
        {chosen ? (
          <>
            <Check size={15} /> 投票済み
          </>
        ) : myVote ? (
          'この案に変更'
        ) : (
          <>
            <Vote size={15} /> この案に投票
          </>
        )}
      </button>
    );
  }
  if (vote?.status === 'tie') {
    if (!vote.tieInstanceIds.includes(instanceId)) return null;
    return isHost ? (
      <button className={styles.primary} onClick={() => void send('RESOLVE_TIE', { instanceId })}>
        この案に決定
      </button>
    ) : (
      <span className={styles.muted}>同票：ホストが決定します</span>
    );
  }
  const direct = snapshot.mode === 'solo' || (snapshot.upper.length === 1 && isHost);
  if (direct && snapshot.status === 'audition_active') {
    return (
      <button
        className={styles.secondary}
        onClick={() => {
          if (window.confirm('この案を採択しますか？')) void send('SELECT_CHAMPION', { instanceId });
        }}
      >
        <Check size={15} /> この案を採択
      </button>
    );
  }
  return null;
}

/** 右上：採決の状況（だれが投票済みか）。採決前はホストに「採決を始める」 */
function BallotStatus({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const { isHost, isSpectator } = useMe();
  const vote = snapshot.vote;
  if (vote?.status === 'open') {
    const judges = snapshot.judges.filter((j) => j.connected);
    const done = judges.filter((j) => vote.votedJudgeIds.includes(j.judgeId)).length;
    return (
      <div className={styles.ballot} role="status" aria-label={`投票 ${done} / ${judges.length}`}>
        <span>採決中</span>
        {judges.map((j) => (
          <span key={j.judgeId} className={styles.voter} data-voted={vote.votedJudgeIds.includes(j.judgeId) || undefined}>
            {vote.votedJudgeIds.includes(j.judgeId) && <Check size={11} />}
            {j.name ?? j.label}
          </span>
        ))}
        <b>
          {done} / {judges.length}
        </b>
        {isHost && done < judges.length && (
          <button className={styles.secondary} onClick={() => void send('CLOSE_VOTE', {})}>
            締め切る
          </button>
        )}
      </div>
    );
  }
  if (vote?.status === 'tie') return <span className={styles.muted}>同票：ホストが決定します</span>;
  if (isSpectator || snapshot.mode === 'solo' || snapshot.upper.length < 2) return null;
  return (
    <button
      className={styles.primary}
      disabled={snapshot.status !== 'audition_active'}
      onClick={() => {
        if (!isHost) {
          toast('採決はホストが始めます', 'warn');
          return;
        }
        void send('START_CHAMPION_VOTE', {});
      }}
    >
      <Vote size={15} /> 採決を始める
    </button>
  );
}

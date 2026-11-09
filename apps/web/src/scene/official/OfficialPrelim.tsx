import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, FileText, Loader2, Pause, Play, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { EMPTY, currentRevision, finalistTarget, useMe } from '../../shared/selectors.ts';
import { JudgeWipe } from '../../features/call/CallControls.tsx';
import { setHoverFocus } from '../focus.ts';
import { OfficialAgenda } from './OfficialAgenda.tsx';
import { QA } from './QA.tsx';
import styles from './Official.module.css';

/**
 * オフィシャル会議モードの予選（提案の審査）。キャラ・舞台・効果音は出さない。
 * 左：いまの提案（文書のように）と、参加者ごとの承認。右：採択候補。
 * 中身は予選と同じ：全員が承認（＝ブザー）したら採択候補（＝合格）、見送ると次の提案（＝交代）
 */
export function OfficialPrelim() {
  const snapshot = useSession((s) => s.snapshot)!;
  const current = snapshot.lowerSlots[0] ?? null;
  return (
    <div className={styles.meeting}>
      <OfficialAgenda phase={0} right={current ? <Timer snapshot={snapshot} instanceId={current} /> : null} />
      <div className={styles.body}>
        <main className={styles.main}>
          <AnimatePresence mode="wait" initial={false}>
            {current ? (
              <motion.div key={current} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <ProposalDoc snapshot={snapshot} instanceId={current} />
              </motion.div>
            ) : (
              <motion.div key="prep" className={styles.preparing} initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="status">
                <Loader2 size={18} className={styles.spin} />
                次の提案を準備しています
              </motion.div>
            )}
          </AnimatePresence>
          <Approval snapshot={snapshot} instanceId={current} />
        </main>
        <Shortlist snapshot={snapshot} />
      </div>
    </div>
  );
}

/** いまの提案。本文に乗せると確認中（交代のカウントが止まる）、押すと詳細・質問 */
function ProposalDoc({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const select = useDisplay((s) => s.select);
  const revision = currentRevision(snapshot, instanceId);
  const character = snapshot.characters[instanceId];
  if (!revision || !character) return null;
  const pitch = snapshot.ideas[character.ideaId]?.pitch;
  const number = Object.keys(snapshot.characters).indexOf(instanceId) + 1;
  return (
    <article className={styles.doc} onPointerEnter={() => setHoverFocus(instanceId)} onPointerLeave={() => setHoverFocus(null)}>
      <div className={styles.docEyebrow}>
        <span>提案 {number}</span>
        {pitch?.reason && <span className={styles.tag}>{pitch.reason}</span>}
      </div>
      <h1 className={styles.docTitle}>{revision.title}</h1>
      <p className={styles.docSummary}>{revision.summary}</p>
      {revision.outline && (
        <dl className={styles.facts}>
          <div>
            <dt>対象</dt>
            <dd>{revision.outline.who}</dd>
          </div>
          <div>
            <dt>課題</dt>
            <dd>{revision.outline.pain}</dd>
          </div>
          <div>
            <dt>解決策</dt>
            <dd>{revision.outline.how}</dd>
          </div>
        </dl>
      )}
      <QA snapshot={snapshot} instanceId={instanceId} />
      <button className={styles.linkButton} onClick={() => select(instanceId)}>
        <FileText size={15} /> 詳細・質問
      </button>
    </article>
  );
}

/** 参加者ごとの承認（＝ブザー）。押せるのは自分の分だけ。下に一時停止と見送り */
function Approval({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string | null }) {
  const send = useSession((s) => s.send);
  const { judgeId, isSpectator } = useMe();
  const pressed = (instanceId && snapshot.buzzer?.instanceId === instanceId ? snapshot.buzzer.judgeIds : null) ?? (EMPTY as readonly string[]);
  const connected = snapshot.judges.filter((j) => j.connected);
  const held = instanceId ? snapshot.characters[instanceId]?.holdBy != null : false;
  const mine = !!judgeId && pressed.includes(judgeId);
  return (
    <section className={styles.approval} aria-label="承認">
      <div className={styles.sectionHead}>
        <h2>承認</h2>
        <span className={styles.count}>
          {pressed.length} / {connected.length}
        </span>
      </div>
      <div className={styles.tiles} style={{ '--n': snapshot.judges.length } as CSSProperties}>
        {snapshot.judges.map((j) => {
          const on = pressed.includes(j.judgeId);
          return (
            <div key={j.judgeId} className={styles.tile} data-on={on || undefined} data-offline={!j.connected || undefined}>
              <JudgeWipe judgeId={j.judgeId} letter={j.letter ?? j.label.slice(-1)} name={j.name ?? j.label} color={j.color} host={j.isHost} />
              <span className={styles.tileState}>{on ? <Check size={14} /> : null}</span>
            </div>
          );
        })}
      </div>
      {!isSpectator && (
        <div className={styles.actions}>
          <button
            className={styles.primary}
            data-on={mine || undefined}
            disabled={!instanceId}
            aria-pressed={mine}
            onClick={() => instanceId && void send('PRESS_BUZZER', { instanceId, on: !mine })}
          >
            <Check size={16} /> {mine ? '承認済み' : '承認する'}
          </button>
          <button className={styles.secondary} disabled={!instanceId} onClick={() => instanceId && void send('HOLD_CHALLENGE', { instanceId, on: !held })}>
            {held ? <Play size={15} /> : <Pause size={15} />} {held ? '再開' : '一時停止'}
          </button>
          <button className={styles.secondary} disabled={!instanceId} onClick={() => instanceId && void send('REJECT_CANDIDATE', { instanceId })}>
            <SkipForward size={15} /> 見送る
          </button>
        </div>
      )}
    </section>
  );
}

/** 採択候補（＝合格者）。そろったら最終審議へ。ホストは途中でも進められる */
function Shortlist({ snapshot }: { snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const { isHost } = useMe();
  const target = finalistTarget(snapshot);
  const fresh = useFresh(snapshot.upper.map((f) => f.instanceId));
  return (
    <aside className={styles.side} aria-label="採択候補">
      <div className={styles.sectionHead}>
        <h2>採択候補</h2>
        <span className={styles.count}>
          {snapshot.upper.length} / {target}
        </span>
      </div>
      <ol className={styles.shortlist}>
        {Array.from({ length: target }, (_, i) => {
          const f = snapshot.upper[i];
          const rev = f ? currentRevision(snapshot, f.instanceId) : null;
          return f && rev ? (
            <motion.li key={f.instanceId} data-fresh={fresh.has(f.instanceId) || undefined} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
              <button onClick={() => select(f.instanceId)}>
                <b>{String.fromCharCode(65 + i)}</b>
                <span>{rev.title}</span>
              </button>
            </motion.li>
          ) : (
            <li key={`empty-${i}`} data-empty>
              <b>{String.fromCharCode(65 + i)}</b>
              <span>—</span>
            </li>
          );
        })}
      </ol>
      {isHost && snapshot.upper.length > 0 && snapshot.upper.length < target && (
        <button
          className={styles.secondary}
          onClick={() => {
            if (window.confirm(`いまの${snapshot.upper.length}件で最終審議に進みますか？`)) void send('END_PRELIMINARY', {});
          }}
        >
          最終審議へ進む <ChevronRight size={15} />
        </button>
      )}
    </aside>
  );
}

/** 新しく採択候補に入った案（数秒だけ印を付ける） */
function useFresh(ids: readonly string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids.join(',');
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    ids.forEach((id) => seen.current!.add(id));
    if (added.length === 0) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

/** 残り時間。確認中（本文に乗せている・詳細を開いている）や一時停止中は止まる */
function Timer({ snapshot, instanceId }: { snapshot: SessionSnapshot; instanceId: string }) {
  const c = snapshot.characters[instanceId];
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!c) return null;
  if (c.holdBy != null) return <span className={styles.timer} data-state="held">一時停止中</span>;
  const leftMs = c.pausedLeftMs ?? (c.leavingAt ? Date.parse(c.leavingAt) - Date.now() : null);
  if (leftMs == null) return null;
  const sec = Math.max(0, Math.ceil(leftMs / 1000));
  const text = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <span className={styles.timer} data-state={c.pausedLeftMs != null ? 'paused' : sec <= 5 ? 'low' : undefined} role="timer" aria-label={`残り${sec}秒`}>
      {c.pausedLeftMs != null ? '確認中' : '残り'} <b>{text}</b>
    </span>
  );
}

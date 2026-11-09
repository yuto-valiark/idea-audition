import { AnimatePresence, motion } from 'motion/react';
import { Crown, SkipForward, Sparkles } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { UPPER_CAPACITY, type JudgeView } from '@idea-audition/protocol';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { EMPTY, currentRevision, useMe } from '../shared/selectors.ts';
import { setHoverFocus } from './focus.ts';
import { InspiredBy } from '../features/consensus/ConsensusMemo.tsx';
import { MentionBadge } from './LowerStage.tsx';
import styles from './Prelim.module.css';
import stage from './Stage.module.css';

/**
 * 予選（#5）：新しいアイデアは1人ずつ登場する。
 * 審査員全員がゴールデンブザーを押したら合格して「合格者待機室」へ。3人そろったら最終オーディションに切り替わる。
 */
export function PreliminaryStage() {
  const challenger = useSession((s) => s.snapshot?.lowerSlots[0] ?? null);
  return (
    <section className={styles.prelim} aria-label="新規アイデア発表ステージ">
      <WaitingRoom />
      <SkipButton instanceId={challenger} />
      <div className={styles.center}>
        <AnimatePresence mode="popLayout">
          {challenger ? <Challenger key={challenger} instanceId={challenger} /> : <Preparing key="prep" />}
        </AnimatePresence>
        <div className={`${stage.ring} ${styles.floor}`} />
      </div>
      <Buzzers instanceId={challenger} />
      <History current={challenger} />
    </section>
  );
}

function WaitingRoom() {
  const snapshot = useSession((s) => s.snapshot)!;
  const select = useDisplay((s) => s.select);
  return (
    <div className={styles.waiting} aria-label="合格者待機室">
      <div className={styles.waitingHead}>
        <Crown size={16} /> 合格者待機室
        <span className={styles.badge}>
          {snapshot.upper.length} / {UPPER_CAPACITY}
        </span>
      </div>
      <div className={styles.seats}>
        {Array.from({ length: UPPER_CAPACITY }, (_, i) => {
          const f = snapshot.upper[i];
          const c = f ? snapshot.characters[f.instanceId] : null;
          const rev = f ? currentRevision(snapshot, f.instanceId) : null;
          return c && rev ? (
            <button key={f!.instanceId} className={styles.seat} onClick={() => select(f!.instanceId)} title={rev.title}>
              <span className={styles.face} style={{ '--accent': c.accent } as CSSProperties}>
                <Mascot designId={c.designId} />
              </span>
              <span className={styles.seatTitle}>{rev.title}</span>
            </button>
          ) : (
            <div key={`empty-${i}`} className={styles.seat} aria-label="空席">
              <span className={`${styles.face} ${styles.emptyFace}`}>
                <Crown size={18} />
              </span>
              <span className={styles.seatTitle}>&nbsp;</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Challenger({ instanceId }: { instanceId: string }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const select = useDisplay((s) => s.select);
  const bubble = useDisplay((s) => s.bubbles[instanceId]);
  const character = snapshot.characters[instanceId];
  const revision = currentRevision(snapshot, instanceId);
  if (!character || !revision) return null;
  return (
    <motion.div
      className={styles.challenger}
      style={{ '--accent': character.accent } as CSSProperties}
      onPointerEnter={() => setHoverFocus(instanceId)}
      onPointerLeave={() => setHoverFocus(null)}
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -60, scale: 0.85, transition: { duration: 0.3 } }}
      transition={{ type: 'spring', stiffness: 220, damping: 20 }}
    >
      <div className={styles.beam} aria-hidden />
      <div className={styles.performer}>
        {bubble && <div className={stage.speech}>{bubble.text}</div>}
        <button className={styles.mascotButton} onClick={() => select(instanceId)} aria-label={`${character.name}の詳細を開く`}>
          <Mascot designId={character.designId} className={styles.mascot} />
        </button>
        <div className={stage.name}>
          <span /> {character.name}
          <MentionBadge count={character.mentions} />
        </div>
      </div>
      <div className={styles.cardColumn}>
        <button className={`${stage.flip} ${styles.flip}`} onClick={() => select(instanceId)}>
          <div className={stage.flipTitle}>{revision.title}</div>
          <div className={stage.flipIcon}>{revision.icon}</div>
          <p>{revision.summary}</p>
          {revision.inspiredBy && <InspiredBy note={revision.inspiredBy.note} labels={revision.inspiredBy.claimLabels} />}
        </button>
        <TimeBar leavingAt={character.leavingAt} />
      </div>
    </motion.div>
  );
}

/** 持ち時間：細い線が減っていく（大きな数字は出さない） */
function TimeBar({ leavingAt }: { leavingAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!leavingAt) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [leavingAt]);
  const total = 15_000;
  const left = leavingAt ? Math.max(0, Date.parse(leavingAt) - now) : total;
  return (
    <div className={styles.timeBar} role="timer" aria-label={`あと${Math.ceil(left / 1000)}秒で次の人と交代`}>
      <i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
    </div>
  );
}

function Preparing() {
  return (
    <motion.div className={styles.preparing} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <span className={stage.spinner} />
      <p>次の挑戦者が準備中…</p>
    </motion.div>
  );
}

function SkipButton({ instanceId }: { instanceId: string | null }) {
  const send = useSession((s) => s.send);
  const { isSpectator } = useMe();
  if (isSpectator || !instanceId) return null;
  return (
    <button className={styles.skip} onClick={() => void send('REJECT_CANDIDATE', { instanceId })} title="この案は見送って、次の人と交代する">
      <SkipForward size={13} /> 次の人へ
    </button>
  );
}

/** ゴールデンブザー：審査員ごとに1つ。押せるのは自分のぶんだけ。全員が押したら合格 */
function Buzzers({ instanceId }: { instanceId: string | null }) {
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const pressed = useSession((s) => (s.snapshot?.buzzer?.instanceId === instanceId ? s.snapshot?.buzzer?.judgeIds : null) ?? (EMPTY as readonly string[]));
  const send = useSession((s) => s.send);
  const { judgeId } = useMe();
  const active = judges.filter((j) => j.connected);
  return (
    <div className={styles.buzzers} aria-label={`ゴールデンブザー ${pressed.length} / ${active.length}`}>
      {active.map((j) => (
        <Buzzer
          key={j.judgeId}
          judge={j}
          on={pressed.includes(j.judgeId)}
          mine={j.judgeId === judgeId}
          disabled={!instanceId || j.judgeId !== judgeId}
          onPress={(on) => instanceId && void send('PRESS_BUZZER', { instanceId, on })}
        />
      ))}
    </div>
  );
}

function Buzzer(props: { judge: JudgeView; on: boolean; mine: boolean; disabled: boolean; onPress(on: boolean): void }) {
  const { judge, on, mine } = props;
  return (
    <button
      className={styles.buzzer}
      data-on={on || undefined}
      data-mine={mine || undefined}
      disabled={props.disabled}
      onClick={() => props.onPress(!on)}
      aria-pressed={on}
      aria-label={mine ? (on ? 'ゴールデンブザーを取り消す' : 'ゴールデンブザーを押す') : `${judge.label}のブザー${on ? '（押した）' : ''}`}
      style={{ '--judge': judge.color } as CSSProperties}
    >
      {on && <Sparkles className={styles.burst} size={22} />}
      <span className={styles.dome} />
      <span className={styles.base}>
        <span className={styles.letter}>{judge.letter ?? judge.label.slice(-1)}</span>
        {judge.name ?? judge.label}
        {judge.isHost && <Crown size={14} className={styles.host} />}
      </span>
    </button>
  );
}

/** これまでの挑戦者：参考程度に、小さく下に並べる */
function History({ current }: { current: string | null }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const select = useDisplay((s) => s.select);
  const past = Object.values(snapshot.characters)
    .filter((c) => c.instanceId !== current && (c.location === 'archived' || c.location === 'upper'))
    .sort((a, b) => Date.parse(b.spawnedAt ?? '') - Date.parse(a.spawnedAt ?? ''))
    .slice(0, 6);
  return (
    <div className={styles.history} aria-label="これまでの挑戦者">
      <span className={styles.historyLabel}>▸ これまでの挑戦者</span>
      {past.length === 0 && <span className={styles.historyEmpty}>まだいません</span>}
      {past.map((c) => {
        const rev = currentRevision(snapshot, c.instanceId);
        const passed = c.location === 'upper';
        return (
          <button key={c.instanceId} className={styles.past} onClick={() => select(c.instanceId)}>
            <Mascot designId={c.designId} className={styles.pastFace} />
            <span className={styles.pastTitle}>{rev?.title}</span>
            <span className={styles.result} data-passed={passed || undefined}>
              {passed ? '合格' : '見送り'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

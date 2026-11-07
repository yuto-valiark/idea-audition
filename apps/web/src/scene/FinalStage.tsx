import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, Crown, Plus, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { UPPER_CAPACITY } from '@idea-audition/protocol';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { EMPTY, currentRevision, originalRevision, useMe } from '../shared/selectors.ts';
import { onDropHover, registerDropZone } from './drag.ts';
import { MentionBadge } from './LowerStage.tsx';
import { InspiredBy } from '../features/consensus/ConsensusMemo.tsx';
import styles from './Stage.module.css';

export function FinalStage() {
  const ref = useRef<HTMLElement>(null);
  const upper = useSession((s) => s.snapshot?.upper ?? EMPTY);
  const isDragging = useDisplay((s) => s.drag?.phase === 'dragging');
  const [hover, setHover] = useState(false);

  useEffect(() => {
    registerDropZone(ref.current);
    const off = onDropHover(setHover);
    return () => {
      registerDropZone(null);
      off();
    };
  }, []);

  const full = upper.length >= UPPER_CAPACITY;

  return (
    <section
      ref={ref}
      className={styles.finalStage}
      data-drop={isDragging ? (full ? 'full' : 'active') : undefined}
      data-hover={hover || undefined}
      aria-label="最終オーディション"
    >
      <div className={styles.heading}>
        <div>
          <Crown />
          <h2>
            最終オーディション <span>FINAL STAGE</span>
          </h2>
          <span className={`${styles.count} ${styles.gold}`}>
            {upper.length} / {UPPER_CAPACITY}
          </span>
        </div>
        <ChampionControls />
      </div>
      <div className={styles.finalLineup}>
        {Array.from({ length: UPPER_CAPACITY }, (_, i) => {
          const f = upper[i];
          return f ? (
            <FinalistCard key={f.instanceId} instanceId={f.instanceId} />
          ) : (
            <EmptySlot key={`empty-${i}`} index={i} dragging={isDragging} full={full} />
          );
        })}
      </div>
      {isDragging && full && <div className={styles.fullNotice}>満席です（最大3体）。いまは昇格できません</div>}
      <div className={`${styles.ring} ${styles.upperRing}`} />
    </section>
  );
}

function EmptySlot({ index, dragging, full }: { index: number; dragging: boolean; full: boolean }) {
  return (
    <div className={styles.emptySlot} data-anchor={`upper-slot:${index}`}>
      <div className={styles.emptyOrbit}>
        <Crown />
        <Plus size={16} />
      </div>
      <p>{dragging && !full ? 'ここにドロップして昇格' : '気になるキャラをここへ'}</p>
      <span>{dragging && !full ? 'DROP TO PROMOTE' : 'キャラクターをドラッグして選抜'}</span>
    </div>
  );
}

const STATUS_LABEL = {
  refining: '◌ 分析・ブラッシュアップ中',
  critiquing: '◌ 相互批評中',
  ready: '',
} as const;

function FinalistCard({ instanceId }: { instanceId: string }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const finalist = snapshot.upper.find((f) => f.instanceId === instanceId)!;
  const character = snapshot.characters[instanceId];
  const revision = currentRevision(snapshot, instanceId);
  const original = originalRevision(snapshot, instanceId);
  const arriving = useDisplay((s) => s.arriving.has(instanceId));
  const bubble = useDisplay((s) => s.bubbles[instanceId]);
  const select = useDisplay((s) => s.select);
  const { isHost, isSpectator } = useMe();
  const myVote = useDisplay((s) => s.myVote);
  const setMyVote = useDisplay((s) => s.setMyVote);
  if (!character || !revision || !original) return null;

  const vote = snapshot.vote;
  const evolved = revision.version > 1;
  const bubbleTarget = bubble ? snapshot.characters[bubble.toInstanceId]?.name : null;
  const isTieCandidate = vote?.status === 'tie' && vote.tieInstanceIds.includes(instanceId);

  return (
    <article
      className={`${styles.performer} ${styles.finalPerformer}`}
      data-status={finalist.status}
      data-arriving={arriving || undefined}
      style={{ '--accent': character.accent } as CSSProperties}
    >
      <AnimatePresence>
        {bubble && (
          <motion.div
            key={bubble.critiqueId}
            className={`${styles.speech} ${styles.critique}`}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            {bubbleTarget && <b>→ {bubbleTarget}</b>}
            {bubble.text}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        className={styles.character}
        data-anchor={`upper:${instanceId}`}
        aria-label={`${character.name}の詳細`}
        onClick={() => select(instanceId)}
      >
        <Mascot designId={character.designId} className={styles.mascot} />
      </button>
      <button className={`${styles.flip} ${styles.finalFlip}`} onClick={() => select(instanceId)}>
        {evolved && <div className={styles.origin}>元の案：{original.title}</div>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={revision.revisionId}
            initial={{ rotateX: -80, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 80, opacity: 0 }}
            transition={{ duration: 0.45 }}
            className={styles.flipBody}
          >
            <div className={styles.flipTitle}>{revision.title}</div>
            <p>{revision.summary}</p>
            {revision.inspiredBy && <InspiredBy note={revision.inspiredBy.note} labels={revision.inspiredBy.claimLabels} />}
            {evolved && (
              <ul className={styles.points}>
                {revision.keepStrengths.slice(0, 1).map((t) => (
                  <li key={`k${t}`} data-kind="keep">
                    残す：{t}
                  </li>
                ))}
                {revision.improvementPoints.slice(0, 2).map((t) => (
                  <li key={`i${t}`}>
                    <Check size={10} /> {t}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        </AnimatePresence>
        <div className={styles.improvement}>
          {finalist.status !== 'ready'
            ? STATUS_LABEL[finalist.status]
            : `✓ ${evolved ? '改善済み' : '選抜アイデア'} · Ver.${revision.version}`}
        </div>
      </button>
      <div className={styles.podium} />
      <div className={styles.name}>
        <span /> {character.name} <small>FINALIST</small>
        <MentionBadge count={character.mentions} />
      </div>

      {vote?.status === 'open' && !isSpectator && (
        <button
          className={styles.voteButton}
          data-chosen={myVote === instanceId || undefined}
          onClick={async () => {
            const r = await send('CAST_VOTE', { instanceId });
            if (r.ok) setMyVote(instanceId);
          }}
        >
          {myVote === instanceId ? '✓ 投票済み' : 'この案に投票'}
        </button>
      )}
      {isTieCandidate &&
        (isHost ? (
          <button className={styles.voteButton} onClick={() => send('RESOLVE_TIE', { instanceId })}>
            この案に決定
          </button>
        ) : (
          <span className={styles.tieNote}>同票：ホストが決定中</span>
        ))}
    </article>
  );
}

function ChampionControls() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const select = useDisplay((s) => s.select);
  const toast = useDisplay((s) => s.toast);
  const { isHost, isSpectator } = useMe();
  const vote = snapshot.vote;
  const upper = snapshot.upper;
  const connected = snapshot.judges.filter((j) => j.connected).length;

  if (vote?.status === 'open') {
    return (
      <div className={styles.voteStatus}>
        <Trophy size={14} /> 投票中 {vote.votedJudgeIds.length} / {connected}
        {isHost && (
          <button className={styles.finalButton} onClick={() => send('CLOSE_VOTE', {})}>
            締め切る
          </button>
        )}
      </div>
    );
  }
  if (vote?.status === 'tie') return <div className={styles.voteStatus}>同票：ホストが選びます</div>;

  return (
    <button
      className={styles.finalButton}
      disabled={upper.length === 0 || isSpectator || snapshot.status !== 'audition_active'}
      onClick={() => {
        if (snapshot.mode === 'solo') {
          select(upper[0]!.instanceId);
          toast('優勝にしたい案を開いて「この案を優勝に」を押してください', 'gold');
          return;
        }
        if (!isHost) {
          toast('優勝の決定はホストが始めます', 'warn');
          return;
        }
        if (upper.length === 1) {
          select(upper[0]!.instanceId);
          return;
        }
        void send('START_CHAMPION_VOTE', {});
      }}
    >
      <Trophy size={14} /> 優勝を決める <ArrowUpRight size={14} />
    </button>
  );
}

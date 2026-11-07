import { Check, Crown, FileDown, Loader2, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { downloadProposalPdf } from './proposal-pdf.tsx';
import { CHARACTER_DESIGNS } from '@idea-audition/protocol';
import { useSession } from '../../store/session-store.ts';
import { useDisplay } from '../../store/display-store.ts';
import { Mascot } from '../../shared/Mascot.tsx';
import { useMe } from '../../shared/selectors.ts';
import styles from './Champion.module.css';

export function ChampionScreen() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const { isHost } = useMe();
  const champ = snapshot.champion!;
  const character = snapshot.characters[champ.instanceId];
  const idea = snapshot.ideas[champ.ideaId];
  const rev = idea?.revisions.find((r) => r.revisionId === champ.revisionId) ?? idea?.revisions.at(-1);
  if (!character || !idea || !rev) return null;
  const allPoints = idea.revisions.flatMap((r) => r.improvementPoints);
  const tally = snapshot.vote?.tally;

  return (
    <section className={styles.champion}>
      <div className={styles.confetti} aria-hidden>
        {Array.from({ length: 48 }, (_, n) => (
          <i
            key={n}
            style={{
              left: `${(n * 37) % 100}%`,
              animationDelay: `${(n % 8) * 0.17}s`,
              background: CHARACTER_DESIGNS[n % CHARACTER_DESIGNS.length]!.accent,
            }}
          />
        ))}
      </div>
      <div className={styles.eyebrow}>THE WINNER OF SESSION {snapshot.sessionId.toUpperCase()}</div>
      <Crown className={styles.crown} />
      <h1>IDEA CHAMPION</h1>
      <div className={styles.spot}>
        <Mascot designId={character.designId} className={styles.mascot} />
      </div>
      <h2>{rev.title}</h2>
      <p className={styles.summary}>{rev.summary}</p>
      {allPoints.length > 0 && (
        <div className={styles.notes}>
          {allPoints.slice(-4).map((t, i) => (
            <p key={`${t}${i}`}>
              <Check size={15} /> {t}
            </p>
          ))}
        </div>
      )}
      <span className={styles.meta}>
        {character.name} · Ver.{rev.version}（全{idea.revisions.length}版）
        {tally ? ` · 得票 ${tally[champ.instanceId] ?? 0}` : ''}
      </span>
      <ProposalButton />
      <div className={styles.actions}>
        {isHost || snapshot.mode === 'solo' ? (
          <button className={styles.primary} onClick={() => void send('RESET_SESSION', {})}>
            <RotateCcw size={17} /> 新しいオーディションへ
          </button>
        ) : (
          <span className={styles.meta}>ホストが次のオーディションを始めます</span>
        )}
        <button
          className={styles.secondary}
          onClick={() => {
            const text = [rev.title, rev.summary, ...allPoints.map((p) => `・${p}`)].join('\n');
            navigator.clipboard?.writeText(text).then(
              () => toast('優勝アイデアをコピーしました', 'gold'),
              () => toast('コピーできませんでした', 'warn'),
            );
          }}
        >
          アイデアをコピー
        </button>
      </div>
    </section>
  );
}

/** 優勝と同時に作り始めた企画書を、できしだい1クリックで PDF ダウンロードできるようにする */
function ProposalButton() {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const toast = useDisplay((s) => s.toast);
  const [saving, setSaving] = useState(false);
  const proposal = snapshot.proposal;
  if (!proposal) return null;

  if (proposal.status === 'generating') {
    return (
      <div className={styles.proposal} data-state="generating" role="status">
        <Loader2 size={18} className={styles.spin} /> 企画書と審査レポートを作成中…
        <small>決まった案と、ここまでの審査の流れをまとめています</small>
      </div>
    );
  }
  if (proposal.status === 'failed') {
    return (
      <div className={styles.proposal} data-state="failed">
        企画書を作れませんでした
        <button onClick={() => void send('REGENERATE_PROPOSAL', {})}>もう一度作る</button>
      </div>
    );
  }
  return (
    <motion.div
      className={styles.proposal}
      data-state="ready"
      initial={{ opacity: 0, y: 12, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      <button
        className={styles.download}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await downloadProposalPdf(snapshot);
            toast('企画書をダウンロードしました', 'gold');
          } catch (e) {
            console.error(e);
            toast('PDFを作れませんでした。もう一度お試しください', 'warn');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? <Loader2 size={18} className={styles.spin} /> : <FileDown size={18} />}
        {saving ? 'PDFを作成中…' : '企画書PDFをダウンロード'}
      </button>
      <small>企画書（AI作成）＋ 審査レポート（合意の経緯・改良の流れ・批評・質疑・投票）</small>
    </motion.div>
  );
}

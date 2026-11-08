import { Pin, PinOff, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useEffect } from 'react';
import type { ClaimView, SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { judgeById, useMe } from '../../shared/selectors.ts';
import styles from './Consensus.module.css';

const STATUS_LABEL: Record<ClaimView['status'], string> = {
  agreed: '合意',
  proposed: '提案中',
  rejected: '却下',
  superseded: '置き換え',
};

const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/** 合意メモ：会話から生まれた論点と、誰がいつ賛成・反対したか（ADR-0007） */
export function ConsensusMemo() {
  const open = useDisplay((s) => s.consensusOpen);
  const setOpen = useDisplay((s) => s.setConsensusOpen);
  const snapshot = useSession((s) => s.snapshot);
  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open || !snapshot) return null;
  const claims = snapshot.consensus.claims;
  const groups: [string, ClaimView[]][] = [
    ['合意', claims.filter((c) => c.status === 'agreed')],
    ['提案中', claims.filter((c) => c.status === 'proposed')],
    ['却下・置き換え', claims.filter((c) => c.status === 'rejected' || c.status === 'superseded')],
  ];
  return (
    <section className={styles.panel} aria-label="合意メモ">
      <header>
        <strong>合意メモ</strong>
        <small>会話から自動で記録 · v{snapshot.consensus.version}</small>
        <button aria-label="閉じる" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </header>
      {claims.length === 0 ? (
        <p className={styles.empty}>
          まだ論点はありません。「コストは低めがいい」「留学生も対象にしたい」のように話すと、ここに記録されます。
        </p>
      ) : (
        <div className={styles.groups}>
          {groups.map(([title, items]) =>
            items.length === 0 ? null : (
              <div key={title}>
                <h3>{title}</h3>
                {items.map((c) => (
                  <ClaimRow key={c.label} claim={c} snapshot={snapshot} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function ClaimRow({ claim, snapshot }: { claim: ClaimView; snapshot: SessionSnapshot }) {
  const send = useSession((s) => s.send);
  const { isSpectator } = useMe();
  const inactive = claim.status === 'superseded';
  const judgeMark = (judgeId: string | null) => {
    const j = judgeId ? judgeById(snapshot, judgeId) : null;
    return j ? (
      <span className={styles.judge} style={{ ['--judge' as string]: j.color }}>
        {j.letter ?? j.label.slice(-1)}
      </span>
    ) : null;
  };
  return (
    <div className={styles.claim} data-status={claim.status}>
      <div className={styles.claimHead}>
        <b>{claim.label}</b>
        <span className={styles.badge}>{claim.pinned ? '確定' : STATUS_LABEL[claim.status]}</span>
        <p>{claim.text}</p>
      </div>
      <div className={styles.stances}>
        {Object.entries(claim.stances).map(([judgeId, stance]) => (
          <span key={judgeId} data-stance={stance}>
            {judgeMark(judgeId)}
            {stance === 'support' ? '賛成' : '反対'}
          </span>
        ))}
        {claim.supersededBy && <span>→ {claim.supersededBy} に置き換え</span>}
      </div>
      <ol className={styles.timeline}>
        {claim.history.map((h, i) => (
          <li key={i}>
            {time(h.at)} {judgeMark(h.judgeId)} {i === 0 && h.judgeId === claim.createdBy ? '提案' : h.stance === 'support' ? '賛成' : '反対'}
          </li>
        ))}
      </ol>
      {!isSpectator && !inactive && (
        <div className={styles.actions}>
          <button
            title="賛成（会話として記録されます）"
            onClick={() => void send('SUBMIT_UTTERANCE', { text: `${claim.label}「${claim.text}」に賛成`, source: 'text', replyToClaim: claim.label })}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            title="反対（会話として記録されます）"
            onClick={() => void send('SUBMIT_UTTERANCE', { text: `${claim.label}「${claim.text}」には反対`, source: 'text', replyToClaim: claim.label })}
          >
            <ThumbsDown size={13} />
          </button>
          <button
            title={claim.pinned ? '確定を取り消す' : 'これで決まり（確定）'}
            onClick={() => void send(claim.pinned ? 'UNPIN_CLAIM' : 'PIN_CLAIM', { label: claim.label })}
          >
            {claim.pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        </div>
      )}
    </div>
  );
}

/** フリップに「どの合意・論点を受けた案か」を出す */
export function InspiredBy({ note, labels }: { note: string; labels: string[] }) {
  return (
    <div className={styles.inspired} title={`${labels.join('・')} を受けた案`}>
      💡 {note}
    </div>
  );
}

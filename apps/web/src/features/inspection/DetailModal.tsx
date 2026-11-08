import { Crown, MessageCircle, Send, Sparkles, Trophy, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { PITCH_ROLE_ICON, UPPER_CAPACITY } from '@idea-audition/protocol';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { Mascot } from '../../shared/Mascot.tsx';
import { useMe } from '../../shared/selectors.ts';
import styles from './Modal.module.css';

/** キャラをクリックしたときの個別深掘り（第21.2章、AC-14） */
export function DetailModal() {
  const selected = useDisplay((s) => s.selected);
  const select = useDisplay((s) => s.select);
  const snapshot = useSession((s) => s.snapshot);
  const send = useSession((s) => s.send);
  const { judgeId, isHost, isSpectator } = useMe();
  const [message, setMessage] = useState('');
  const [showBefore, setShowBefore] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMessage('');
    setShowBefore(false);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && select(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, select]);

  // 投票が始まったら、下段の案の詳細は閉じる（投票のボタンを隠さないように）
  const status = snapshot?.status;
  const selectedLocation = selected ? snapshot?.characters[selected]?.location : undefined;
  useEffect(() => {
    if (selected && status && status !== 'audition_active' && selectedLocation !== 'upper') select(null);
  }, [selected, status, selectedLocation, select]);

  if (!selected || !snapshot) return null;
  const character = snapshot.characters[selected];
  const idea = character ? snapshot.ideas[character.ideaId] : undefined;
  if (!character || !idea) return null;

  const revisions = idea.revisions;
  const current = revisions[revisions.length - 1]!;
  const original = revisions[0]!;
  const shown = showBefore ? original : current;
  const finalist = snapshot.upper.find((f) => f.instanceId === selected);
  const where = finalist ? '最終オーディション' : character.location === 'lower' ? '新規アイデア' : 'アイデアBOX';
  const answers = snapshot.answers.filter((a) => a.instanceId === selected).slice(-3).reverse();
  const active = snapshot.status === 'audition_active';
  const canChampion =
    !!finalist && active && (snapshot.mode === 'solo' || (snapshot.upper.length === 1 && isHost));
  const upperFull = snapshot.upper.length >= UPPER_CAPACITY;

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={() => select(null)}>
      <section
        className={styles.detail}
        role="dialog"
        aria-modal="true"
        aria-label={`${current.title}の詳細`}
        onClick={(e) => e.stopPropagation()}
        style={{ '--accent': character.accent } as CSSProperties}
      >
        <button className={styles.close} aria-label="閉じる" onClick={() => select(null)}>
          <X />
        </button>
        <div className={styles.top}>
          <Mascot designId={character.designId} className={styles.topMascot} />
          <div>
            <div className={styles.eyebrow}>
              {character.name} / {where}
            </div>
            <h2>{shown.title}</h2>
            {!showBefore && current.title !== original.title && <div className={styles.origin}>元の案：{original.title}</div>}
            <span className={styles.version}>
              Ver.{shown.version}
              {showBefore ? '（元の案）' : revisions.length > 1 ? `（全${revisions.length}版）` : ''}
            </span>
          </div>
        </div>
        <p className={styles.desc}>{shown.summary}</p>
        {(shown.outline ?? original.outline) && (
          <dl className={styles.outline}>
            <div>
              <dt>誰の</dt>
              <dd>{(shown.outline ?? original.outline)!.who}</dd>
            </div>
            <div>
              <dt>困りごと</dt>
              <dd>{(shown.outline ?? original.outline)!.pain}</dd>
            </div>
            <div>
              <dt>どう解く</dt>
              <dd>{(shown.outline ?? original.outline)!.how}</dd>
            </div>
          </dl>
        )}
        {idea.pitch && character.location === 'lower' && (
          <p className={styles.pitch}>
            この案を出した理由：{PITCH_ROLE_ICON[idea.pitch.role]} {idea.pitch.reason}
          </p>
        )}

        {revisions.length > 1 && (
          <div className={styles.evolution}>
            <button onClick={() => setShowBefore(!showBefore)}>
              {showBefore ? '改良版を見る →' : '← Before / After'}
            </button>
            {!showBefore && (
              <>
                {current.reason && <p className={styles.reason}>{current.reason}</p>}
                <div className={styles.evoGrid}>
                  <div>
                    <small>残す強み</small>
                    {current.keepStrengths.map((t) => (
                      <p key={t}>・{t}</p>
                    ))}
                  </div>
                  <div>
                    <small>今回の改善ポイント</small>
                    {current.improvementPoints.map((t) => (
                      <p key={t}>✓ {t}</p>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {character.location !== 'archived' && (
          <div className={styles.conversation}>
            <div className={styles.questionTitle}>
              <MessageCircle size={17} /> このアイデアを、もっと深く。
            </div>
            {answers.map((a) => (
              <div key={a.answerId} className={styles.answer}>
                <b>Q. {a.question}</b>
                <p>{a.answer ?? '考え中…'}</p>
              </div>
            ))}
            <form
              className={styles.questionInput}
              onSubmit={(e) => {
                e.preventDefault();
                if (!message.trim()) return;
                void run(() => send('ASK_CANDIDATE', { instanceId: selected, text: message.trim() })).then(
                  (r) => r.ok && setMessage(''),
                );
              }}
            >
              <input
                value={message}
                maxLength={300}
                disabled={isSpectator}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={finalist ? '質問、または改善してほしいこと' : '気になることを質問'}
              />
              <Send size={17} />
            </form>
            <div className={styles.questionActions}>
              <button
                disabled={busy || isSpectator || !message.trim()}
                onClick={() =>
                  void run(() => send('ASK_CANDIDATE', { instanceId: selected, text: message.trim() })).then(
                    (r) => r.ok && setMessage(''),
                  )
                }
              >
                質問する
              </button>
              {finalist && (
                <button
                  disabled={busy || isSpectator || !message.trim() || !active}
                  onClick={() =>
                    void run(() => send('REQUEST_REFINEMENT', { instanceId: selected, text: message.trim() }, { expected: { rev: current.revisionId } })).then(
                      (r) => {
                        if (!r.ok) return;
                        setMessage('');
                        useDisplay.getState().toast('改善を依頼しました。上段で新しい版を作ります', 'gold');
                      },
                    )
                  }
                >
                  <Sparkles size={14} /> 改善を依頼
                </button>
              )}
            </div>
          </div>
        )}

        {character.location === 'lower' && (
          <button
            className={styles.secondary}
            disabled={busy || isSpectator || !active}
            onClick={() =>
              void run(() => send('REJECT_CANDIDATE', { instanceId: selected })).then((r) => r.ok && select(null))
            }
          >
            この案は見送る（次の人と交代）
          </button>
        )}
        {character.location === 'lower' && (
          <button
            className={styles.primary}
            disabled={busy || isSpectator || !active || upperFull}
            onClick={() =>
              void run(() => send('REQUEST_PROMOTION', { instanceId: selected })).then((r) => r.ok && select(null))
            }
          >
            <Crown size={18} /> {upperFull ? '最終オーディションは満席です' : '最終オーディションへ選抜'}
          </button>
        )}
        {finalist && (
          <button
            className={styles.primary}
            data-tone="gold"
            disabled={busy || !canChampion || isSpectator}
            onClick={() => void run(() => send('SELECT_CHAMPION', { instanceId: selected }))}
          >
            <Trophy size={18} />
            {canChampion ? 'この案を優勝に' : snapshot.mode === 'team' ? '優勝は投票で決めます（ホストが開始）' : 'この案を優勝に'}
          </button>
        )}
        <small className={styles.hint}>
          質問は案を変更しません。改善依頼で新しい版に更新されます。
          {judgeId === null ? '（観覧モードでは操作できません）' : ''}
        </small>
      </section>
    </div>
  );
}

export function IdeaBoxModal() {
  const open = useDisplay((s) => s.ideaBoxOpen);
  const setOpen = useDisplay((s) => s.setIdeaBoxOpen);
  const select = useDisplay((s) => s.select);
  const snapshot = useSession((s) => s.snapshot);
  if (!open || !snapshot) return null;
  const items = snapshot.ideaBox.slice().reverse();
  return (
    <div className={styles.backdrop} onClick={() => setOpen(false)}>
      <section className={styles.box} role="dialog" aria-label="アイデアBOX" onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} aria-label="閉じる" onClick={() => setOpen(false)}>
          <X />
        </button>
        <h2>アイデアBOX</h2>
        <p>入れ替わったアイデアは、ここに残ります。</p>
        {items.length === 0 ? (
          <div className={styles.boxEmpty}>まだ保存されたアイデアはありません。</div>
        ) : (
          items.map((x) => {
            const idea = snapshot.ideas[x.ideaId];
            const rev = idea?.revisions[idea.revisions.length - 1];
            const instanceId = Object.values(snapshot.characters).find((c) => c.ideaId === x.ideaId)?.instanceId;
            return (
              <button
                key={x.ideaId}
                className={styles.boxItem}
                onClick={() => {
                  setOpen(false);
                  if (instanceId) select(instanceId);
                }}
              >
                <Mascot designId={x.designId} className={styles.boxMascot} />
                <span>
                  <b>{rev?.title}</b>
                  <small>
                    {x.characterName} · {x.reason === 'rejected' ? '見送り' : x.reason === 'replaced' ? '入れ替え' : '時間切れ'}
                  </small>
                </span>
              </button>
            );
          })
        )}
      </section>
    </div>
  );
}

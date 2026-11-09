import { BookOpen, Check, ChevronLeft, ChevronRight, Copy, Crown, Expand, EyeOff, FileDown, Loader2, Minimize2, RotateCcw, Share2, X } from 'lucide-react';
import { championText } from './share-text.ts';
import { copyText } from '../../shared/copy-text.ts';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { downloadProposalPdf } from './proposal-pdf.tsx';
import { PROPOSAL_PAGES, ProposalDocument } from './ProposalDocument.tsx';
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
  const [viewerOpen, setViewerOpen] = useState(true);
  const champ = snapshot.champion!;
  const character = snapshot.characters[champ.instanceId];
  const idea = snapshot.ideas[champ.ideaId];
  const rev = idea?.revisions.find((r) => r.revisionId === champ.revisionId) ?? idea?.revisions.at(-1);

  useEffect(() => {
    setViewerOpen(true);
  }, [snapshot.sessionId, snapshot.champion?.instanceId]);

  if (!character || !idea || !rev) return null;
  // 今の案（優勝した版）の内容だけを出す。過去の版の改善点を足し合わせると、やめた条件が混ざって矛盾する
  const outline = rev.outline ?? null;
  const allPoints = outline ? [`誰の：${outline.who}`, `困りごと：${outline.pain}`, `どう解く：${outline.how}`] : rev.improvementPoints;
  const tally = snapshot.vote?.tally;
  // 企画書ができていれば中身を、まだなら案の説明と改善点を、チャットに貼れる文章にする
  const shareText = () =>
    championText({
      theme: snapshot.theme,
      title: rev.title,
      summary: rev.summary,
      points: allPoints,
      proposal: snapshot.proposal?.status === 'ready' ? snapshot.proposal.content : null,
    });
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as { share?: unknown }).share === 'function';
  const showViewer = viewerOpen && !!snapshot.proposal;

  return (
    <section className={styles.champion} data-viewer-open={showViewer || undefined}>
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
      <div className={styles.leftPane}>
        <div className={styles.hero}>
          <div className={styles.eyebrow}>THE WINNER OF SESSION {snapshot.sessionId.toUpperCase()}</div>
          <Crown className={styles.crown} />
          <h1>IDEA CHAMPION</h1>
          <div className={styles.spot}>
            <Mascot designId={character.designId} className={styles.mascot} />
          </div>
        </div>
        <div className={styles.body}>
          <h2>{rev.title}</h2>
          <p className={styles.summary}>{rev.summary}</p>
          {allPoints.length > 0 && (
            <div className={styles.notes}>
              {allPoints.map((t, i) => (
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
          <ProposalDownloadBar viewerOpen={viewerOpen} onToggleViewer={() => setViewerOpen((v) => !v)} />
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
                void copyText(shareText()).then((ok) =>
                  ok
                    ? toast(snapshot.proposal?.content ? '企画書の文章をコピーしました' : '優勝アイデアの文章をコピーしました', 'gold')
                    : toast('コピーできませんでした。ブラウザのコピーの許可を確かめてください', 'warn'),
                );
              }}
            >
              <Copy size={16} /> 文章をコピー
            </button>
            {canShare && (
              <button
                className={styles.secondary}
                onClick={() => {
                  void (navigator as Navigator & { share: (d: ShareData) => Promise<void> })
                    .share({ title: `IDEA AUDITION 優勝案：${rev.title}`, text: shareText() })
                    .catch(() => {});
                }}
              >
                <Share2 size={16} /> 共有
              </button>
            )}
          </div>
        </div>
      </div>
      {showViewer && <ProposalViewerPane onClose={() => setViewerOpen(false)} />}
    </section>
  );
}

/** 優勝と同時に作り始めた企画書を、できしだい1クリックで PDF ダウンロード・プレビュー開閉できるようにする */
function ProposalDownloadBar({
  viewerOpen,
  onToggleViewer,
}: {
  viewerOpen: boolean;
  onToggleViewer: () => void;
}) {
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
        <button type="button" className={styles.toggleViewerBtn} onClick={onToggleViewer}>
          {viewerOpen ? (
            <>
              <EyeOff size={15} /> プレビューをしまう
            </>
          ) : (
            <>
              <BookOpen size={15} /> プレビューを表示
            </>
          )}
        </button>
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
      <div className={styles.proposalRow}>
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
        <button
          type="button"
          className={styles.toggleViewerBtn}
          aria-expanded={viewerOpen}
          onClick={onToggleViewer}
        >
          {viewerOpen ? (
            <>
              <EyeOff size={16} /> 企画書をしまう
            </>
          ) : (
            <>
              <BookOpen size={16} /> 企画書を見る
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

/** ダウンロードしなくても、優勝画面のその場で企画書PDFの中身をめくって読めるビューア */
function ProposalViewerPane({ onClose }: { onClose: () => void }) {
  const snapshot = useSession((s) => s.snapshot)!;
  const send = useSession((s) => s.send);
  const proposal = snapshot.proposal;
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const modalViewportRef = useRef<HTMLDivElement>(null);
  const totalPages = PROPOSAL_PAGES.length;

  useEffect(() => {
    setPage(0);
    setExpanded(false);
  }, [snapshot.sessionId, snapshot.champion?.instanceId]);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
    modalViewportRef.current?.scrollTo({ top: 0 });
  }, [page, expanded]);

  useEffect(() => {
    if (proposal?.status !== 'ready' || !proposal.content) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        setPage((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        setPage((p) => Math.min(totalPages - 1, p + 1));
      } else if (e.key === 'Escape' && expanded) {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proposal?.status, proposal?.content, totalPages, expanded]);

  if (!proposal) return null;

  if (proposal.status === 'generating') {
    return (
      <aside className={styles.viewerPane} aria-label="企画書プレビュー">
        <div className={styles.viewerHeader}>
          <div className={styles.viewerTitleGroup}>
            <span className={styles.viewerBadge}>企画書プレビュー</span>
          </div>
          <div className={styles.viewerNav}>
            <button
              type="button"
              className={styles.closeViewerBtn}
              aria-label="企画書プレビューをしまう"
              onClick={onClose}
            >
              <X size={15} />
              <span>しまう</span>
            </button>
          </div>
        </div>
        <div className={styles.viewerPlaceholder} role="status">
          <Loader2 size={28} className={styles.spin} />
          <strong>企画書と審査レポートを作成しています…</strong>
          <p>できあがると、この場所で企画書と審査レポートを読めます。</p>
        </div>
      </aside>
    );
  }

  if (proposal.status === 'failed' || !proposal.content) {
    return (
      <aside className={styles.viewerPane} aria-label="企画書プレビュー">
        <div className={styles.viewerHeader}>
          <div className={styles.viewerTitleGroup}>
            <span className={styles.viewerBadge}>企画書プレビュー</span>
          </div>
          <div className={styles.viewerNav}>
            <button
              type="button"
              className={styles.closeViewerBtn}
              aria-label="企画書プレビューをしまう"
              onClick={onClose}
            >
              <X size={15} />
              <span>しまう</span>
            </button>
          </div>
        </div>
        <div className={styles.viewerPlaceholder}>
          <strong>企画書を作れませんでした</strong>
          <button className={styles.retryBtn} onClick={() => void send('REGENERATE_PROPOSAL', {})}>
            もう一度作る
          </button>
        </div>
      </aside>
    );
  }

  const currentMeta = PROPOSAL_PAGES[page] ?? PROPOSAL_PAGES[0]!;

  const renderControls = (isModal: boolean) => (
    <div className={styles.viewerHeader}>
      <div className={styles.viewerTitleGroup}>
        <span className={styles.viewerBadge}>{currentMeta.part}</span>
        <strong className={styles.viewerSectionTitle}>{currentMeta.label}</strong>
      </div>
      <div className={styles.viewerNav}>
        <button
          type="button"
          className={styles.pageBtn}
          aria-label="前のページ"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft size={16} /> 前へ
        </button>
        <span className={styles.pageCounter} aria-live="polite">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          className={styles.pageBtn}
          aria-label="次のページ"
          disabled={page >= totalPages - 1}
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        >
          次へ <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className={styles.expandBtn}
          aria-label={isModal ? '拡大表示を閉じる' : '企画書を拡大して表示'}
          title={isModal ? '閉じる' : '大きく表示'}
          onClick={() => setExpanded(!isModal)}
        >
          {isModal ? <Minimize2 size={15} /> : <Expand size={15} />}
          <span>{isModal ? '閉じる' : '拡大'}</span>
        </button>
        {!isModal && (
          <button
            type="button"
            className={styles.closeViewerBtn}
            aria-label="企画書プレビューをしまう"
            title="プレビューをしまう"
            onClick={onClose}
          >
            <X size={15} />
            <span>しまう</span>
          </button>
        )}
      </div>
    </div>
  );

  const renderTabs = () => (
    <div className={styles.pageTabs} role="tablist" aria-label="企画書のパート一覧">
      {PROPOSAL_PAGES.map((p) => (
        <button
          key={p.index}
          type="button"
          role="tab"
          aria-selected={page === p.index}
          className={styles.pageTab}
          data-active={page === p.index || undefined}
          onClick={() => setPage(p.index)}
        >
          {p.shortLabel}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <aside className={styles.viewerPane} aria-label="企画書ビューア">
        {renderControls(false)}
        {renderTabs()}
        <div ref={viewportRef} className={styles.viewerViewport}>
          <ProposalDocument snapshot={snapshot} content={proposal.content} page={page} preview />
        </div>
      </aside>

      {expanded && (
        <div className={styles.modalBackdrop} onClick={() => setExpanded(false)}>
          <section
            className={styles.modalViewer}
            role="dialog"
            aria-modal="true"
            aria-label="企画書ビューア（拡大表示）"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalCloseIcon}
              aria-label="閉じる"
              onClick={() => setExpanded(false)}
            >
              <X size={18} />
            </button>
            {renderControls(true)}
            {renderTabs()}
            <div ref={modalViewportRef} className={styles.viewerViewport}>
              <ProposalDocument snapshot={snapshot} content={proposal.content} page={page} preview />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

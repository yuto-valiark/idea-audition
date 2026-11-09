import { Crown, Layers, RotateCcw, Users, ChevronRight, Wifi, WifiOff, Share2, Copy, Volume2, VolumeX } from 'lucide-react';
import { setMuted, useMuted } from '../../shared/sfx.ts';
import { canShareInvite, copyInvite, shareInvite } from '../../shared/invite.ts';
import { CallBadge, CallControls, CallMicButton } from '../call/CallControls.tsx';
import { useEffect } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import { Captions, MicButton, UtteranceInput } from '../voice/VoiceControls.tsx';
import { ConsensusMemo } from '../consensus/ConsensusMemo.tsx';
import { TastePanel } from '../taste/TasteRadar.tsx';
import styles from './Chrome.module.css';

export function Header() {
  const sessionId = useSession((s) => s.sessionId);
  const connection = useSession((s) => s.connection);
  const room = useSession((s) => s.room);
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const lobby = useSession((s) => s.snapshot?.status === 'lobby');
  const connected = judges.filter((j) => j.connected).length;
  const { isSpectator } = useMe();
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img className={styles.logo} src="/brand/logo-neon-sm.webp" alt="IDEA AUDITION" />
      </div>
      <div className={styles.tag}>AIがプレゼン。あなたが審査員。</div>
      {room === 'active' && (
      <div className={styles.right}>
        {connection === 'open' ? (
          <span className={styles.status}>
            <span className={styles.onlineDot} /> {sessionId.toUpperCase()}
          </span>
        ) : (
          <span className={styles.statusWarn}>
            <WifiOff size={14} /> 再接続中…
          </span>
        )}
        <span className={styles.divider} />
        <Users size={15} />
        <span>{connected}人で参加中</span>
        {isSpectator && <span className={styles.spectator}>観覧モード</span>}
        {import.meta.env.DEV && <AiModeBadge />}
        <CallControls />
        {lobby && !isSpectator && <CallMicButton />}
        <SoundToggle />
        <button type="button" className={styles.copy} onClick={() => void copyInvite()} title="この部屋のリンクをコピー">
          <Copy size={14} /> コピー
        </button>
        {canShareInvite() && (
          <button type="button" className={styles.invite} onClick={() => void shareInvite()} title="この部屋のリンクを共有（AirDrop・LINE など）">
            <Share2 size={14} /> 招待
          </button>
        )}
        {connection === 'open' && <Wifi size={14} className={styles.wifi} />}
      </div>
      )}
    </header>
  );
}

/** 効果音のオン・オフ（この端末に覚える） */
function SoundToggle() {
  const muted = useMuted();
  return (
    <button
      type="button"
      className={styles.copy}
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      title={muted ? '効果音をオンにする' : '効果音をオフにする'}
    >
      {muted ? <VolumeX size={14} /> : <Volume2 size={14} />} {muted ? '音オフ' : '音オン'}
    </button>
  );
}

export function Footer() {
  const snapshot = useSession((s) => s.snapshot);
  const send = useSession((s) => s.send);
  const openBox = useDisplay((s) => s.setIdeaBoxOpen);
  const consensusOpen = useDisplay((s) => s.consensusOpen);
  const setConsensusOpen = useDisplay((s) => s.setConsensusOpen);
  const tasteOpen = useDisplay((s) => s.tasteOpen);
  const setTasteOpen = useDisplay((s) => s.setTasteOpen);
  const { judgeId, isHost } = useMe();
  if (!snapshot) return null;
  return (
    <footer className={styles.footer}>
      <Captions />
      <div className={styles.judges}>
        {snapshot.judges.map((j) => (
          <div
            key={j.judgeId}
            className={styles.judge}
            data-you={j.judgeId === judgeId || undefined}
            data-offline={!j.connected || undefined}
            style={{ ['--judge' as string]: j.color }}
          >
            <span className={styles.avatar}>{j.letter ?? j.label.slice(-1)}</span>
            <div>
              <strong>
                {j.label}
                {j.judgeId === judgeId ? '（あなた）' : ''}
              </strong>
              <small>
                <span /> {j.connected ? (j.isHost ? 'ホスト' : '参加中') : '切断中'}
              </small>
            </div>
            {j.isHost && <Crown size={13} className={styles.hostCrown} aria-label="ホスト" />}
            <CallBadge judgeId={j.judgeId} />
            {j.judgeId === judgeId ? <MicButton /> : null}
          </div>
        ))}
      </div>
      <UtteranceInput />
      <div className={styles.actions}>
        <TastePanel />
        <button onClick={() => setTasteOpen(!tasteOpen)} aria-expanded={tasteOpen} title="反応から読み取ったみんなの好み">
          🧭 <span className={styles.btnLabel}>好み</span> {snapshot.taste.divergence ? <b>割れ</b> : null}
        </button>
        <ConsensusMemo />
        <button
          onClick={() => {
            setConsensusOpen(!consensusOpen);
            if (!consensusOpen) setTasteOpen(false);
          }}
          aria-expanded={consensusOpen}
        >
          🤝 <span className={styles.btnLabel}>合意メモ</span> <b>{snapshot.consensus.claims.filter((c) => c.status === 'agreed').length}</b>
        </button>
        <button onClick={() => openBox(true)} data-anchor="ideabox">
          <Layers size={16} /> <span className={styles.btnLabel}>アイデアBOX</span> <b>{snapshot.ideaBox.length}</b>
          <ChevronRight size={15} />
        </button>
        {isHost && (
          <button
            title="最初からやり直す"
            aria-label="最初からやり直す"
            onClick={() => {
              if (confirm('セッションを最初からやり直しますか？（全員の画面が開始画面に戻ります）')) {
                void send('RESET_SESSION', {});
              }
            }}
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>
    </footer>
  );
}

export function Toasts() {
  const toasts = useDisplay((s) => s.toasts);
  const dismiss = useDisplay((s) => s.dismissToast);
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} text={t.text} tone={t.tone} onDone={dismiss} />
      ))}
    </div>
  );
}

function ToastItem(props: { id: string; text: string; tone: string; onDone: (id: string) => void }) {
  const { id, onDone } = props;
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 3800);
    return () => clearTimeout(t);
  }, [id, onDone]);
  return (
    <div className={styles.toast} data-tone={props.tone}>
      {props.text}
    </div>
  );
}

/** いまの AI のモード。ホストは押して切り替えられる（Gemini はクレジットを使う） */
function AiModeBadge() {
  const ai = useSession((s) => s.snapshot?.ai);
  const status = useSession((s) => s.snapshot?.status);
  const send = useSession((s) => s.send);
  const { isHost } = useMe();
  if (!ai || status === 'lobby') return null;
  const next = ai.mode === 'gemini' ? 'fixture' : 'gemini';
  const canSwitch = isHost && ai.available.includes(next);
  const label = ai.mode === 'gemini' ? 'AI：Gemini' : '固定データ';
  return (
    <button
      className={styles.aiBadge}
      data-mode={ai.mode}
      disabled={!canSwitch}
      title={
        canSwitch
          ? `${next === 'gemini' ? 'Gemini（クレジットを使う）' : '固定データ（無料）'}に切り替える`
          : ai.mode === 'gemini'
            ? 'Gemini で生成中（クレジットを使います）'
            : '固定データで動作中（無料）'
      }
      onClick={() => {
        const message =
          next === 'gemini'
            ? 'Gemini に切り替えますか？（クレジットを使います。作り置きの案は入れ替わります）'
            : '固定データに切り替えますか？（無料。作り置きの案は入れ替わります）';
        if (confirm(message)) void send('SET_AI_MODE', { mode: next });
      }}
    >
      {label}
    </button>
  );
}

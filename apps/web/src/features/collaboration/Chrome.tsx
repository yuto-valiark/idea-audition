import { Crown, Layers, RotateCcw, Users, ChevronRight, Wifi, WifiOff } from 'lucide-react';
import { useEffect } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import { Captions, MicButton, MicIndicator, UtteranceInput } from '../voice/VoiceControls.tsx';
import styles from './Chrome.module.css';

export function Header() {
  const sessionId = useSession((s) => s.sessionId);
  const connection = useSession((s) => s.connection);
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const connected = judges.filter((j) => j.connected).length;
  const { isSpectator } = useMe();
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Crown />
        <strong>
          IDEA <span>AUDITION</span>
        </strong>
      </div>
      <div className={styles.tag}>AIがプレゼン。あなたが審査員。</div>
      <div className={styles.right}>
        {connection === 'open' ? (
          <span className={styles.status}>
            <span className={styles.onlineDot} /> SESSION {sessionId.toUpperCase()}
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
        {connection === 'open' && <Wifi size={14} className={styles.wifi} />}
      </div>
    </header>
  );
}

export function Footer() {
  const snapshot = useSession((s) => s.snapshot);
  const send = useSession((s) => s.send);
  const openBox = useDisplay((s) => s.setIdeaBoxOpen);
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
            <span className={styles.avatar}>{j.label.slice(-1)}</span>
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
            {j.judgeId === judgeId ? <MicButton /> : <MicIndicator judgeId={j.judgeId} />}
          </div>
        ))}
      </div>
      <UtteranceInput />
      <div className={styles.actions}>
        <button onClick={() => openBox(true)}>
          <Layers size={16} /> アイデアBOX <b>{snapshot.ideaBox.length}</b>
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

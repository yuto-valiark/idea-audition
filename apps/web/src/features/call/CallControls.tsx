import { Headphones, Mic, MicOff, PhoneOff } from 'lucide-react';
import { useSession } from '../../store/session-store.ts';
import { useMe } from '../../shared/selectors.ts';
import { useCall } from './call-store.ts';
import styles from './Call.module.css';

/**
 * 通話（声）の操作。離れた場所から参加するとき用。
 * 同じ部屋に集まっているなら入らなくてよい（声が二重に聞こえるため）。
 */
export function CallControls() {
  const room = useSession((s) => s.room);
  const { me, isSpectator } = useMe();
  const inCall = useCall((s) => s.inCall);
  const joining = useCall((s) => s.joining);
  const muted = useCall((s) => s.muted);
  const peers = useCall((s) => s.peers.length);
  const others = useCall((s) => Object.values(s.inCallOthers).filter(Boolean).length);
  const join = useCall((s) => s.join);
  const leave = useCall((s) => s.leave);
  const toggleMute = useCall((s) => s.toggleMute);
  if (room !== 'active' || isSpectator || !me) return null;

  if (!inCall) {
    return (
      <button type="button" className={styles.join} onClick={() => void join()} disabled={joining} title="離れた場所の人と声でつながる（同じ部屋にいるなら不要）">
        <Headphones size={14} /> {joining ? 'つないでいます…' : others > 0 ? `通話に参加（${others}人が通話中）` : '通話に参加'}
      </button>
    );
  }
  return (
    <span className={styles.bar} role="group" aria-label="通話">
      <span className={styles.live}>
        <Headphones size={14} /> 通話中 {peers > 0 ? `· ${peers}人とつながっています` : '· ほかの人を待っています'}
      </span>
      <button type="button" className={styles.icon} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'ミュートを解除' : 'ミュート'} title={muted ? 'ミュートを解除' : 'ミュート'}>
        {muted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      <button type="button" className={styles.leave} onClick={leave} aria-label="通話から抜ける" title="通話から抜ける">
        <PhoneOff size={14} />
      </button>
    </span>
  );
}

/** 審査員の札に出す印：通話中なら🎧、話していれば光る */
export function CallBadge({ judgeId }: { judgeId: string }) {
  const myId = useSession((s) => s.judgeId);
  const inCall = useCall((s) => (judgeId === myId ? s.inCall : !!s.inCallOthers[judgeId]));
  const speaking = useCall((s) => !!s.speaking[judgeId]);
  if (!inCall) return null;
  return (
    <span className={styles.badge} data-speaking={speaking || undefined} aria-label={speaking ? '話しています' : '通話中'}>
      <Headphones size={11} />
    </span>
  );
}

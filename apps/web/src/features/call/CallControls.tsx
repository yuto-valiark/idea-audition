import { Headphones, Volume2 } from 'lucide-react';
import { useSession } from '../../store/session-store.ts';
import { useMe } from '../../shared/selectors.ts';
import { useCall } from './call-store.ts';
import styles from './Call.module.css';

/**
 * 通話の様子（ヘッダー）。部屋に入ると自動で通話に入り、みんなの声が聞こえる。
 * ミュートはマイクのボタンで切り替える。ブラウザが音を止めているときだけ「音声をオンにする」を出す。
 */
export function CallControls() {
  const room = useSession((s) => s.room);
  const { me, isSpectator } = useMe();
  const blocked = useCall((s) => s.blocked);
  const unlock = useCall((s) => s.unlock);
  if (room !== 'active' || (!isSpectator && !me)) return null;
  if (blocked) {
    return (
      <button type="button" className={styles.join} onClick={() => void unlock()} title="ブラウザが音を止めています。押すとみんなの声が聞こえます">
        <Volume2 size={14} /> 音声をオンにする
      </button>
    );
  }
  // 通話の人数などの表示は出さない（音が止められているときの「音声をオンにする」だけ）
  return null;
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

/** ヘッダーのマイク（ロビーでも使えるように）。押すとミュートを切り替える */
export { MicButton as CallMicButton } from '../voice/VoiceControls.tsx';

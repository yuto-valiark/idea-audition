import { useEffect } from 'react';
import { useSession } from './store/session-store.ts';
import { Arena } from './features/audition/Arena.tsx';
import { Intro } from './features/audition/Intro.tsx';
import { ChampionScreen } from './features/champion/ChampionScreen.tsx';
import { Footer, Header, Toasts } from './features/collaboration/Chrome.tsx';
import { DetailModal, IdeaBoxModal } from './features/inspection/DetailModal.tsx';
import { DragLayer } from './scene/DragLayer.tsx';
import { RoomNotFound } from './features/audition/RoomNotFound.tsx';
import { NameGate } from './features/audition/NameGate.tsx';
import { useCall } from './features/call/call-store.ts';
import { useMe } from './shared/selectors.ts';
import styles from './App.module.css';

/** URL の /a/<部屋 ID> から部屋を読む（Google Meet と同じく、リンクを開いた人がその部屋に入る） */
function roomIdFromUrl() {
  const m = /^\/a\/([^/]+)\/?$/.exec(location.pathname);
  // 形が違う ID もサーバーに聞き、「見つかりません」を出す
  return m ? decodeURIComponent(m[1]!).slice(0, 40) : null;
}

export function App() {
  const connect = useSession((s) => s.connect);
  const leaveRoom = useSession((s) => s.leaveRoom);
  const status = useSession((s) => s.snapshot?.status);
  const hasChampion = useSession((s) => !!s.snapshot?.champion);

  useEffect(() => {
    const follow = () => {
      const roomId = roomIdFromUrl();
      if (!roomId) {
        if (location.pathname !== '/') history.replaceState(null, '', '/');
        if (useSession.getState().room !== 'none') leaveRoom();
      } else if (roomId !== useSession.getState().sessionId) connect(roomId);
    };
    follow();
    // ブラウザの戻る・進むで部屋とトップを行き来できるように
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, [connect, leaveRoom]);

  // 部屋に入って名前が決まったら、自動で通話に入る（みんなの声が聞こえる。ミュートはマイクのボタン）
  // 観覧者（5人目以降）は名前が無くても、聞くだけで入る
  const room = useSession((s) => s.room);
  const connection = useSession((s) => s.connection);
  const { me, isSpectator } = useMe();
  const named = !!me?.name;
  useEffect(() => {
    if (room === 'active' && connection === 'open' && (named || isSpectator)) void useCall.getState().join();
  }, [room, connection, named, isSpectator]);

  const screen =
    status === 'audition_active' || status === 'champion_selection'
      ? 'arena'
      : status === 'completed' && hasChampion
        ? 'champion'
        : 'intro';

  return (
    <main className={styles.main}>
      <Studio />
      <Header />
      {screen === 'intro' && <Intro />}
      {screen === 'arena' && (
        <>
          <Arena />
          <Footer />
        </>
      )}
      {screen === 'champion' && <ChampionScreen />}
      {screen === 'arena' && <DetailModal />}
      <IdeaBoxModal />
      <DragLayer />
      <Toasts />
      <RoomNotFound />
      <NameGate />
    </main>
  );
}

function Studio() {
  return (
    <div className={styles.studio} aria-hidden>
      <div className={styles.truss} />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`${styles.beam} ${styles[`beam${i}`]}`} />
      ))}
      <div className={styles.stars} />
    </div>
  );
}

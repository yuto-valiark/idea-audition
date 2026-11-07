import { useEffect } from 'react';
import { useSession } from './store/session-store.ts';
import { Arena } from './features/audition/Arena.tsx';
import { Intro } from './features/audition/Intro.tsx';
import { ChampionScreen } from './features/champion/ChampionScreen.tsx';
import { Footer, Header, Toasts } from './features/collaboration/Chrome.tsx';
import { DetailModal, IdeaBoxModal } from './features/inspection/DetailModal.tsx';
import { DragLayer } from './scene/DragLayer.tsx';
import styles from './App.module.css';

function sessionIdFromUrl() {
  const raw = new URLSearchParams(location.search).get('s') ?? 'demo';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'demo';
}

export function App() {
  const connect = useSession((s) => s.connect);
  const status = useSession((s) => s.snapshot?.status);
  const hasChampion = useSession((s) => !!s.snapshot?.champion);

  useEffect(() => {
    connect(sessionIdFromUrl());
  }, [connect]);

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

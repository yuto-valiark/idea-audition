import { MousePointer2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { FinalStage } from '../../scene/FinalStage.tsx';
import { PreliminaryStage } from '../../scene/PreliminaryStage.tsx';
import { UPPER_CAPACITY } from '@idea-audition/protocol';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import styles from './Arena.module.css';

const CURSOR_SEND_INTERVAL_MS = 66; // 約15Hz（仮説値。実測で調整する、ADR-0004）

export function Arena() {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useSession((s) => s.snapshot?.theme);
  const client = useSession((s) => s.client);
  // 予選（1人ずつ）：合格者が3人そろうまで。そろったら最終オーディションに切り替わる（#5）
  const prelim = useSession((s) => s.snapshot?.status === 'audition_active' && (s.snapshot?.upper.length ?? 0) < UPPER_CAPACITY);

  useEffect(() => {
    const el = ref.current;
    if (!el || !client) return;
    let last = 0;
    let wasInside = false;
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < CURSOR_SEND_INTERVAL_MS) return;
      last = now;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (inside) client.sendEphemeral('CURSOR_MOVED', { x, y });
      else if (wasInside) client.sendEphemeral('CURSOR_MOVED', null);
      wasInside = inside;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [client]);

  return (
    <>
      <div className={styles.themeBar}>
        <span className={styles.live}>● LIVE</span>
        <span className={styles.themeLabel}>本日のテーマ</span>
        <strong>{theme}</strong>
      </div>
      <div className={styles.arena} ref={ref}>
        {prelim ? <PreliminaryStage /> : <FinalStage />}
        <JudgeCursors />
      </div>
    </>
  );
}

function JudgeCursors() {
  const cursors = useDisplay((s) => s.cursors);
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const { judgeId } = useMe();
  return (
    <>
      {Object.entries(cursors).map(([id, c]) => {
        if (id === judgeId) return null;
        const j = judges.find((x) => x.judgeId === id);
        if (!j || !j.connected) return null;
        return (
          <div
            key={id}
            className={styles.cursor}
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, ['--cursor' as string]: j.color }}
            aria-hidden
          >
            <MousePointer2 fill={j.color} />
            <span>{j.label}</span>
          </div>
        );
      })}
    </>
  );
}

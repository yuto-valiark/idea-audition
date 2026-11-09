import type { ReactNode } from 'react';
import { useSession } from '../../store/session-store.ts';
import styles from './Official.module.css';

const STEPS = ['提案の審査', '最終審議', '採択'] as const;

/**
 * オフィシャル会議モードの上の帯：議題・いまの段階・右端（残り時間や採決の状況）。
 * phase は 0=提案の審査（予選）、1=最終審議（決勝）、2=採択（優勝）
 */
export function OfficialAgenda({ phase, right }: { phase: 0 | 1 | 2; right?: ReactNode }) {
  const theme = useSession((s) => s.snapshot?.theme ?? '');
  return (
    <header className={styles.agenda}>
      <div className={styles.agendaTitle}>
        <span>議題</span>
        <strong>{theme}</strong>
      </div>
      <ol className={styles.steps} aria-label="会議の段階">
        {STEPS.map((label, i) => (
          <li key={label} data-state={i < phase ? 'done' : i === phase ? 'now' : undefined} aria-current={i === phase ? 'step' : undefined}>
            <i>{i + 1}</i>
            {label}
          </li>
        ))}
      </ol>
      <div className={styles.agendaRight}>{right}</div>
    </header>
  );
}

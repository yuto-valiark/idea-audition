import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../store/session-store.ts';
import styles from './AccessGate.module.css';

/** 公開環境の合言葉の入力。サーバーに断られたときだけ出る */
export function AccessGate() {
  const denied = useSession((s) => s.accessDenied);
  const submit = useSession((s) => s.submitAccessCode);
  const [code, setCode] = useState('');
  if (!denied) return null;
  return (
    <div className={styles.backdrop}>
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) submit(code);
        }}
      >
        <KeyRound size={28} />
        <h2>合言葉を入れてください</h2>
        <p>このデモは、合言葉を知っている人だけが参加できます。</p>
        <input
          autoFocus
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="合言葉"
          placeholder="合言葉"
        />
        {denied === 'invalid' && <small className={styles.error}>合言葉が違います</small>}
        <button disabled={!code.trim()}>入る</button>
      </form>
    </div>
  );
}

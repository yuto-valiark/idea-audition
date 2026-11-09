import { Copy, Crown, Play, Plus, Share2, Users, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { canShareInvite, copyInvite, shareInvite } from '../../shared/invite.ts';
import { useEffect, useState } from 'react';
import { roomUrl, useSession } from '../../store/session-store.ts';
import { Mascot } from '../../shared/Mascot.tsx';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import styles from './Intro.module.css';
import './start-screen.css';

const DEMO_THEME = '大学の学食をもっと楽しくする企画';

export function Intro() {
  const send = useSession((s) => s.send);
  const connection = useSession((s) => s.connection);
  const room = useSession((s) => s.room);
  const roomId = useSession((s) => s.sessionId);
  const createRoom = useSession((s) => s.createRoom);
  const { isSpectator, isHost } = useMe();
  const themeDraft = useSession((s) => s.themeDraft);
  const judgeCount = useSession((s) => s.snapshot?.judges.length ?? 0);
  const [theme, setTheme] = useState(DEMO_THEME);
  // 審査は「みんなで審査」、AI は Gemini で固定（選ぶ欄は出さない）。開発版だけ ?ai=fixture で固定データにできる
  const mode = 'team' as const;
  const aiAvailable: readonly ('gemini' | 'fixture')[] = useSession((s) => s.snapshot?.ai.available ?? EMPTY);
  const devFixture = import.meta.env.DEV && new URLSearchParams(location.search).get('ai') === 'fixture';
  const chosenAi = devFixture && aiAvailable.includes('fixture') ? 'fixture' : aiAvailable.includes('gemini') ? 'gemini' : (aiAvailable[0] ?? 'fixture');
  const [busy, setBusy] = useState(false);
  // ホストが入れているテーマと設定を、ほかの人の画面にもそのまま見せる（人が増えたときも送り直す）
  useEffect(() => {
    if (!isHost || room !== 'active' || connection !== 'open') return;
    const t = setTimeout(
      () => useSession.getState().client?.sendEphemeral('THEME_DRAFT', { theme: theme.slice(0, 120), mode, aiMode: chosenAi }),
      200,
    );
    return () => clearTimeout(t);
  }, [isHost, room, connection, theme, mode, chosenAi, judgeCount]);
  const guest = room === 'active' && !isHost;
  const shownTheme = guest ? (themeDraft?.theme ?? '') : theme;

  async function start() {
    if (!theme.trim() || busy || !isHost) return;
    setBusy(true);
    await send('START_AUDITION', { theme: theme.trim(), mode, aiMode: chosenAi });
    setBusy(false);
  }

  const lobby = room === 'active';
  return (
    <section className="welcome-screen" data-lobby={lobby || undefined}>
      <div className="welcome-environment" aria-hidden="true">
        <div className="welcome-roof">
          <div />
          <i />
        </div>
        <div className="welcome-rear-wall" />
        <div className="welcome-light light-center" />
        <div className="welcome-light light-left" />
        <div className="welcome-light light-right" />
        <div className="welcome-light light-left-blue" />
        <div className="welcome-light light-right-blue" />
        <div className="welcome-haze" />
        <div className="welcome-motes">
          {Array.from({ length: 27 }, (_, n) => (
            <i
              key={n}
              style={{
                left: `${(n * 43 + 7) % 100}%`,
                top: `${(n * 31 + 9) % 90}%`,
                animationDelay: `${(n % 9) * -0.8}s`,
                opacity: 0.15 + (n % 5) * 0.12,
              }}
            />
          ))}
        </div>
        <Audience side="left" />
        <Audience side="right" />
        <div className="welcome-ground" />
        <div className="welcome-floor-reflection" />
        <div className="floor-lamp floor-lamp-left" />
        <div className="floor-lamp floor-lamp-right" />
      </div>

      <div className="welcome-content">
        <motion.div className="welcome-identity" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <img className="welcome-logo-img" src="/brand/logo-neon.webp" alt="IDEA AUDITION" />
          <div className="welcome-eyebrow">
            <i />
            <span>THE NEXT BIG IDEA</span>
            <i />
          </div>
        </motion.div>
        <motion.div className="welcome-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.7 }}>
          <h1>
            まだ、人間が<span>アイデア出してるの？</span>
          </h1>
          <p>
            <strong>AIが次々にアイデアをプレゼン。</strong>
            <br />
            あなたの直感で選び、みんなで磨いて、最高の1案へ。
          </p>
        </motion.div>
        <div className="welcome-showcase" aria-hidden>
          <div className="welcome-characters">
            {(['momo', 'sprout', 'luna'] as const).map((name, n) => (
              <motion.div
                key={name}
                className={`welcome-character welcome-character-${name}`}
                initial={{ opacity: 0, y: 35 }}
                animate={{ opacity: 1, y: [0, -5, 0] }}
                transition={{
                  opacity: { delay: 0.2 + n * 0.1, duration: 0.8 },
                  y: { duration: 4.4 + n * 0.4, repeat: Infinity, ease: 'easeInOut', delay: n * 0.2 },
                }}
              >
                <Mascot designId={[0, 1, 2][n]!} className="mascot" />
                <div className="character-contact-shadow" />
              </motion.div>
            ))}
          </div>
          <div className="welcome-platform">
            <div className="welcome-platform-body" />
            <div className="welcome-platform-surface" />
            <div className="welcome-platform-inner" />
            <div className="welcome-platform-lip" />
            <div className="welcome-platform-base" />
          </div>
          <div className="welcome-platform-reflection" />
        </div>

        <div className="welcome-action">
          {lobby ? (
            <form
              className="welcome-setup"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <InviteLink url={roomUrl(roomId)} />
              <div className={styles.themeInput}>
                <span className={styles.themeLabel}>テーマ</span>
                <input
                  id="theme"
                  value={shownTheme}
                  maxLength={120}
                  readOnly={guest}
                  aria-label="今回のオーディションテーマ"
                  placeholder={guest ? 'ホストがテーマを入力しています…' : undefined}
                  onChange={(e) => setTheme(e.target.value)}
                />
              </div>
              {guest ? (
                <div className={styles.waiting}>ホストが始めるのを待っています</div>
              ) : (
                <button className="create-audition" disabled={busy || isSpectator || connection !== 'open' || !theme.trim()}>
                  <Play />
                  <span>オーディションをはじめる</span>
                </button>
              )}
              {(connection !== 'open' || isSpectator) && (
                <small className={styles.note}>{connection !== 'open' ? '接続しています…' : '観覧モード'}</small>
              )}
            </form>
          ) : (
            <button
              className="create-audition"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await createRoom();
                setBusy(false);
              }}
            >
              <Plus />
              <span>オーディションを作る</span>
            </button>
          )}
          <div className="welcome-steps">
            <span>
              <Zap />
              テーマを決める
            </span>
            <i />
            <span>
              <Users />
              直感で選んで、育てる
            </span>
            <i />
            <span>
              <Crown />
              最高の1案を決める
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 左右の客席：バルコニー・LED 画面・観客のシルエット（ChatGPT 版のトップ画面から） */
function Audience({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`arena-wing arena-wing-${side}`} aria-hidden="true">
      <div className="wing-balcony">
        <div className="led-display">
          <i />
          <i />
          <i />
          <span />
        </div>
        <div className="balcony-rail" />
        <svg viewBox="0 0 400 170" className="audience-silhouettes" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`crowd-${side}`} x2="0" y2="1">
              <stop stopColor="#7943a0" />
              <stop offset="1" stopColor="#190929" />
            </linearGradient>
          </defs>
          {Array.from({ length: 40 }, (_, n) => {
            const row = Math.floor(n / 10);
            const x = (n % 10) * 42 - 15 + (row % 2) * 19;
            const y = 20 + row * 35;
            return (
              <g
                key={n}
                transform={`translate(${x} ${y}) rotate(${(n % 3) * 5 - 5})`}
                fill={`url(#crowd-${side})`}
                stroke="#a566c8"
                strokeWidth=".7"
                opacity={0.45 + row * 0.12}
              >
                <ellipse cx="16" cy="3" rx={6 + (n % 3)} ry="9" />
                <path d="M3 38 Q0 16 9 13 Q16 10 23 14 Q34 19 31 40Z" />
                {n % 4 === 0 && <path d="M9 19 L0 -2 M24 20 L35 -6" stroke="#7e469d" strokeWidth="5" strokeLinecap="round" />}
              </g>
            );
          })}
        </svg>
        <div className="crowd-edge" />
      </div>
      <div className="wing-base">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

/** 招待リンク。コピーするか、共有シート（AirDrop・LINE など）で参加者に送る（Google Meet のリンクと同じ使い方） */
function InviteLink({ url }: { url: string }) {
  return (
    <div className={styles.invite}>
      <span className={styles.inviteLabel}>招待リンク</span>
      <code>{url.replace(/^https?:\/\//, '')}</code>
      <button type="button" onClick={() => void copyInvite(url)} aria-label="招待リンクをコピー">
        <Copy size={15} /> コピー
      </button>
      {canShareInvite(url) && (
        <button type="button" className={styles.share} onClick={() => void shareInvite(url)} aria-label="招待リンクを共有">
          <Share2 size={15} /> 招待
        </button>
      )}
    </div>
  );
}

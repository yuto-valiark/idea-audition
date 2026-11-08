import { ArrowRight, Check, ChevronRight, Copy, Crown, Plus, Sparkles } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { CHARACTER_DESIGNS } from '@idea-audition/protocol';
import { roomUrl, useSession } from '../../store/session-store.ts';
import { Mascot } from '../../shared/Mascot.tsx';
import { EMPTY, useMe } from '../../shared/selectors.ts';
import styles from './Intro.module.css';

const DEMO_THEME = '大学の学食をもっと楽しくする企画';

export function Intro() {
  const send = useSession((s) => s.send);
  const connection = useSession((s) => s.connection);
  const room = useSession((s) => s.room);
  const roomId = useSession((s) => s.sessionId);
  const createRoom = useSession((s) => s.createRoom);
  const { isSpectator } = useMe();
  const [theme, setTheme] = useState(DEMO_THEME);
  const [mode, setMode] = useState<'team' | 'solo'>('team');
  const aiAvailable = useSession((s) => s.snapshot?.ai.available ?? EMPTY);
  const [aiMode, setAiMode] = useState<'gemini' | 'fixture' | null>(null);
  const chosenAi = aiMode ?? aiAvailable[0] ?? 'fixture';
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!theme.trim() || busy) return;
    setBusy(true);
    await send('START_AUDITION', { theme: theme.trim(), mode, aiMode: chosenAi });
    setBusy(false);
  }

  return (
    <section className={styles.intro}>
      <div className={styles.copy}>
        <div className={styles.eyebrow}>
          <span /> THE NEXT IDEA IS ON STAGE
        </div>
        <h1>
          まだ、人間が
          <br />
          <em>アイデア出してるの？</em>
        </h1>
        <p className={styles.sub}>
          人間に必要なのは、
          <br />
          <b>「これ、おもろいかも。」</b>そのセンスだけ。
        </p>
        <p className={styles.description}>
          AIが次々にアイデアをプレゼン。
          <br />
          あなたの直感で選び、みんなで磨いて、最高の1案へ。
        </p>
        {room === 'active' ? (
        <form
          className={styles.setup}
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <InviteLink url={roomUrl(roomId)} />
          <label htmlFor="theme">今回のオーディションテーマ</label>
          <div className={styles.themeInput}>
            <input id="theme" value={theme} maxLength={120} onChange={(e) => setTheme(e.target.value)} />
          </div>
          <div className={styles.actions}>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'team' | 'solo')} aria-label="参加モード">
              <option value="team">みんなで審査</option>
              <option value="solo">ひとりで審査</option>
            </select>
            {aiAvailable.length > 1 && (
              <select
                value={chosenAi}
                onChange={(e) => setAiMode(e.target.value as 'gemini' | 'fixture')}
                aria-label="AIのモード"
                title="Gemini はクレジットを使います。固定データは無料で、UIの確認やデモ向けです"
              >
                <option value="gemini">AI：Gemini</option>
                <option value="fixture">固定データ（無料）</option>
              </select>
            )}
            <button className={styles.primary} disabled={busy || isSpectator || connection !== 'open' || !theme.trim()}>
              オーディションをはじめる <ArrowRight size={18} />
            </button>
          </div>
          <small>
            {connection !== 'open'
              ? 'サーバーに接続しています…'
              : isSpectator
                ? '審査員は4人までです。観覧モードで参加しています'
                : 'このリンクを開いた人は、同じステージで一緒に審査できます（最大4人）'}
          </small>
        </form>
        ) : (
          <div className={styles.setup}>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await createRoom();
                setBusy(false);
              }}
            >
              <Plus size={18} /> オーディションを作る
            </button>
            <small>作ると招待リンクができます。リンクを送った人が、同じステージで一緒に審査できます（最大4人）</small>
          </div>
        )}
      </div>
      <div className={styles.stage}>
        <div className={styles.stageTitle}>
          <Crown size={20} /> YOUR NEXT BIG IDEA
        </div>
        <div className={styles.mascots}>
          {[0, 1, 2].map((d) => (
            <div key={d} className={styles.mascotWrap} style={{ '--accent': CHARACTER_DESIGNS[d]!.accent } as CSSProperties}>
              <Mascot designId={d} className={styles.mascot} />
            </div>
          ))}
        </div>
        <div className={styles.ring} />
        <div className={styles.caption}>
          <Sparkles size={16} /> ひらめくのはAI。見つけるのは、あなた。
        </div>
      </div>
      <div className={styles.steps}>
        <span>
          <b>01</b> テーマを決める
        </span>
        <ChevronRight />
        <span>
          <b>02</b> 直感で選んで、育てる
        </span>
        <ChevronRight />
        <span>
          <b>03</b> 最高の1案を決める
        </span>
      </div>
    </section>
  );
}

/** 招待リンク。コピーして参加者に送る（Google Meet のリンクと同じ使い方） */
function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.invite}>
      <span className={styles.inviteLabel}>招待リンク</span>
      <code>{url.replace(/^https?:\/\//, '')}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
        aria-label="招待リンクをコピー"
      >
        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  );
}

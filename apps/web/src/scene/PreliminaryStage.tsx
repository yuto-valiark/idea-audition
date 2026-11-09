import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, ChevronRight, Crown, SkipForward, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PITCH_ROLE_ICON, UPPER_CAPACITY, type JudgeView, type SessionSnapshot } from '@idea-audition/protocol';
import { useDisplay } from '../store/display-store.ts';
import { useSession } from '../store/session-store.ts';
import { Mascot } from '../shared/Mascot.tsx';
import { EMPTY, currentRevision, useMe } from '../shared/selectors.ts';
import { setHoverFocus } from './focus.ts';
import './prelim-gpt.css';

/** 合格の演出の長さ（長いとテンポが落ちる） */
export const PASS_CEREMONY_MS = 2_000;
/** この秒数からカウントダウンを出す。URGENT 秒からは画面を赤くして急かす */
const COUNTDOWN_FROM = 10;
const URGENT_FROM = 5;

/**
 * 予選（#5）：新しいアイデアは1人ずつ登場する。
 * 審査員全員がゴールデンブザーを押したら合格して「合格者待機室」へ。3人そろったら最終オーディションに切り替わる。
 * 見た目は ChatGPT が作ったモック（IDEA_AUDITION 2）のものを使う。データはサーバーの snapshot。
 */
export function PreliminaryStage() {
  const snapshot = useSession((s) => s.snapshot)!;
  const passed = usePassCeremony(snapshot);
  const challenger = snapshot.lowerSlots[0] ?? null;
  // 合格の演出（約2秒）のあいだは合格したキャラを舞台に残し、終わったら次の挑戦者を出す
  const shown = passed?.instanceId ?? challenger;
  const celebrating = !!passed;
  return (
    <div className="ia-prelim">
      <div className="workspace">
        <section className={'stage ' + (celebrating ? 'gold-stage' : '')} aria-label="オーディションステージ">
          <div className="stage-topline">
            <span className="ia-theme">
              <b>● LIVE</b>
              <small>本日のテーマ</small>
              <strong>{snapshot.theme}</strong>
            </span>
          </div>
          <div className="stage-light light-one" />
          <div className="stage-light light-two" />
          <div className="stage-light light-three" />
          <div className="ambient-particles" />
          <WaitingRoom snapshot={snapshot} />
          <img className="ia-backdrop" src="/brand/logo-neon.webp" alt="" aria-hidden />
          <div className="ring-floor">
            <div />
            <i />
          </div>
          <AnimatePresence initial={false}>
            {shown ? (
              <Performance key={shown} snapshot={snapshot} instanceId={shown} promoting={celebrating} />
            ) : (
              <motion.div key="prep" className="solo-performance" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="ia-preparing">次の挑戦者が準備中…</p>
              </motion.div>
            )}
          </AnimatePresence>
          {!celebrating && challenger && <Countdown leavingAt={snapshot.characters[challenger]?.leavingAt ?? null} pausedLeftMs={snapshot.characters[challenger]?.pausedLeftMs ?? null} />}
          <BuzzerZone snapshot={snapshot} instanceId={celebrating ? null : challenger} celebrating={celebrating} />
          {celebrating && <PassEffect seed={passed!.seed} name={snapshot.characters[passed!.instanceId]?.name ?? ''} />}
        </section>
        <History snapshot={snapshot} current={shown} />
      </div>
    </div>
  );
}

/** 合格の演出（約1.3秒）。そのあいだは合格したキャラを舞台に残す */
function usePassCeremony(snapshot: SessionSnapshot) {
  const [passed, setPassed] = useState<{ instanceId: string; seed: number } | null>(null);
  const n = snapshot.upper.length;
  const lastId = snapshot.upper[n - 1]?.instanceId ?? null;
  const prev = useRef(n);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // snapshot は届くたびに新しくなるので、人数（n）が増えたときだけ演出を始める。タイマーは画面の更新で止めない
  useEffect(() => {
    if (n > prev.current && lastId) {
      setPassed({ instanceId: lastId, seed: Date.now() });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPassed(null), PASS_CEREMONY_MS);
    }
    prev.current = n;
  }, [n, lastId]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return passed;
}

function WaitingRoom({ snapshot }: { snapshot: SessionSnapshot }) {
  const select = useDisplay((s) => s.select);
  return (
    <aside className="waiting-room">
      <div className="waiting-heading">
        <Crown size={17} />
        <h2>合格者待機室</h2>
        <b>
          {snapshot.upper.length} / {UPPER_CAPACITY}
        </b>
      </div>
      <div className="waiting-slots">
        {Array.from({ length: UPPER_CAPACITY }, (_, n) => {
          const f = snapshot.upper[n];
          const c = f ? snapshot.characters[f.instanceId] : null;
          const rev = f ? currentRevision(snapshot, f.instanceId) : null;
          return (
            <div className={'waiting-slot ' + (c ? 'filled' : '')} key={n}>
              {c && rev ? (
                <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={() => select(c.instanceId)}>
                  <Mascot designId={c.designId} className="mascot" />
                  <span>{rev.title}</span>
                </motion.div>
              ) : (
                <div className="empty-crown">
                  <Crown size={23} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Performance({ snapshot, instanceId, promoting }: { snapshot: SessionSnapshot; instanceId: string; promoting: boolean }) {
  const reduced = useReducedMotion();
  const select = useDisplay((s) => s.select);
  const bubble = useDisplay((s) => s.bubbles[instanceId]);
  const character = snapshot.characters[instanceId];
  const revision = currentRevision(snapshot, instanceId);
  if (!character || !revision) return null;
  const pitch = snapshot.ideas[character.ideaId]?.pitch;
  return (
    <motion.div
      className="solo-performance"
      initial={{ opacity: 0, y: reduced ? 0 : 45 }}
      animate={{ opacity: promoting ? 0 : 1, y: promoting ? (reduced ? 0 : -220) : 0, scale: promoting ? 0.7 : 1 }}
      // 消えるのはすぐ（透明のまま残ると、次のキャラへのカーソルやクリックをさえぎる）
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      style={{ pointerEvents: promoting ? 'none' : undefined }}
      transition={promoting ? { duration: 1.7, ease: 'easeIn' } : { type: 'spring', stiffness: 110, damping: 17 }}
    >
      <motion.button
        className="hero-character"
        // キャラの体にカーソルを乗せると深掘りタイム（交代のカウントが止まる）
        onPointerEnter={() => setHoverFocus(instanceId)}
        onPointerLeave={() => setHoverFocus(null)}
        onClick={() => select(instanceId)}
        aria-label={`${character.name}の企画詳細`}
        animate={reduced || promoting ? {} : { y: [0, -7, 0] }}
        transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {bubble && <span className="ia-bubble">{bubble.text}</span>}
        <Mascot designId={character.designId} className="mascot" />
        <span className="character-label">
          <span />
          {character.name}
        </span>
      </motion.button>
      <motion.button
        className="idea-flip"
        initial={{ opacity: 0, x: reduced ? 0 : 35 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
        onClick={() => select(instanceId)}
      >
        <div className="flip-eyebrow">
          {pitch ? `${PITCH_ROLE_ICON[pitch.role]} ${pitch.reason}` : `${revision.icon} IDEA`}
          <Sparkles size={15} />
        </div>
        <h1>{revision.title}</h1>
        <div className="flip-rule" />
        <p>{revision.summary}</p>
        <span className="flip-more">
          アイデアを詳しく見る <ArrowRight size={13} />
        </span>
      </motion.button>
    </motion.div>
  );
}

function BuzzerZone({ snapshot, instanceId, celebrating }: { snapshot: SessionSnapshot; instanceId: string | null; celebrating: boolean }) {
  const send = useSession((s) => s.send);
  const { judgeId, isSpectator } = useMe();
  const judges = snapshot.judges.filter((j) => j.connected);
  const pressed = (snapshot.buzzer?.instanceId === instanceId ? snapshot.buzzer?.judgeIds : null) ?? (EMPTY as readonly string[]);
  return (
    <div className="buzzer-zone">
      <div className="buzzers" style={{ '--count': judges.length } as CSSProperties}>
        {judges.map((j) => (
          <Buzzer
            key={j.judgeId}
            judge={j}
            pressed={celebrating || pressed.includes(j.judgeId)}
            disabled={celebrating || !instanceId || j.judgeId !== judgeId}
            onClick={() => instanceId && void send('PRESS_BUZZER', { instanceId, on: !pressed.includes(j.judgeId) })}
          />
        ))}
      </div>
      {!isSpectator && instanceId && (
        <button className="ia-skip" onClick={() => void send('REJECT_CANDIDATE', { instanceId })} aria-label="見送って次のアイデアへ" title="見送る">
          <SkipForward size={22} />
          <span>交代</span>
        </button>
      )}
    </div>
  );
}

function Buzzer({ judge, pressed, disabled, onClick }: { judge: JudgeView; pressed: boolean; disabled: boolean; onClick(): void }) {
  return (
    <motion.button
      whileTap={disabled ? {} : { scale: 0.97 }}
      className={'buzzer ' + (pressed ? 'pressed' : '')}
      style={{ '--person': judge.color } as CSSProperties}
      disabled={disabled}
      onClick={onClick}
      aria-label={`${judge.name ?? judge.label}のブザー`}
      aria-pressed={pressed}
    >
      <span className="buzzer-rays">
        <i />
        <i />
        <i />
      </span>
      <span className="buzzer-dome">
        <span />
        {pressed && <Check size={26} />}
      </span>
      <span className="buzzer-collar" />
      <span className="buzzer-base">
        <span className="person-initial">{judge.letter ?? judge.label.slice(-1)}</span>
        <strong>{judge.name ?? judge.label}</strong>
        {judge.isHost && <Crown size={13} />}
      </span>
      <span className="buzzer-shadow" />
    </motion.button>
  );
}

function PassEffect({ seed, name }: { seed: number; name: string }) {
  const reduce = useReducedMotion();
  return (
    <>
      <div className="confetti" key={`c${seed}`} aria-hidden="true">
        {Array.from({ length: reduce ? 10 : 68 }, (_, n) => (
          <i
            key={n}
            style={
              {
                left: `${(n * 43) % 100}%`,
                top: `${(n * 23) % 70}%`,
                '--dx': `${(n % 2 ? 1 : -1) * (40 + ((n * 7) % 250))}px`,
                '--dy': `${90 + ((n * 17) % 350)}px`,
                animationDelay: `${(n % 11) * 0.045}s`,
                transform: `rotate(${n * 37}deg)`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="pass-effect ascending" key={`p${seed}`}>
        <div className="light-pillar" />
        <div className="gold-orbit orbit1" />
        <div className="gold-orbit orbit2" />
        <motion.div className="pass-title" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <Crown />
          <strong>合格！</strong>
          <span>{name ? `${name} · UNANIMOUS APPROVAL` : 'UNANIMOUS APPROVAL'}</span>
        </motion.div>
      </div>
    </>
  );
}

/**
 * 残り10秒から大きくカウントダウン。5秒からは画面のふちが赤く脈打って急かす。
 * 深掘りタイム中はカウントダウンを止め、右上に残りの秒数だけを出す。
 */
function Countdown({ leavingAt, pausedLeftMs }: { leavingAt: string | null; pausedLeftMs: number | null }) {
  const left = useSecondsLeft(leavingAt);
  if (pausedLeftMs != null) {
    return (
      <div className="ia-corner ia-deepdive" role="status">
        <strong>🔍 深掘りタイム</strong>
        <span>
          残り <b>{Math.ceil(pausedLeftMs / 1000)}</b> 秒
        </span>
      </div>
    );
  }
  if (!leavingAt || left <= 0 || left > COUNTDOWN_FROM) return null;
  const urgent = left <= URGENT_FROM;
  return (
    <>
      {urgent && <div className="ia-urgent" aria-hidden />}
      <div className="ia-countdown" data-urgent={urgent || undefined} role="timer" aria-label={`あと${left}秒で交代`}>
        <small>あと</small>
        <motion.b key={left} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25 }}>
          {left}
        </motion.b>
        <small>秒</small>
      </div>
    </>
  );
}

/** これまでの挑戦者：参考程度に、小さく下に並べる */
function History({ snapshot, current }: { snapshot: SessionSnapshot; current: string | null }) {
  const select = useDisplay((s) => s.select);
  const past = Object.values(snapshot.characters)
    .filter((c) => c.instanceId !== current && (c.location === 'archived' || c.location === 'upper'))
    .sort((a, b) => Date.parse(a.spawnedAt ?? '') - Date.parse(b.spawnedAt ?? ''));
  return (
    <section className="history" aria-label="これまでの挑戦者">
      <h2>
        <ChevronRight size={12} />
        これまでの挑戦者
      </h2>
      <div className="history-items">
        {past.length ? (
          past.map((c) => {
            const passed = c.location === 'upper';
            return (
              <button key={c.instanceId} onClick={() => select(c.instanceId)}>
                <Mascot designId={c.designId} className="mascot" />
                <span>{currentRevision(snapshot, c.instanceId)?.title}</span>
                <b className={passed ? 'passed' : 'skipped'}>{passed ? '合格' : '見送り'}</b>
              </button>
            );
          })
        ) : (
          <span className="empty-history" />
        )}
      </div>
      <span className="history-count">{past.length} IDEAS</span>
    </section>
  );
}

function useSecondsLeft(leavingAt: string | null) {
  // 時刻は描画のたびにその場で読む。止まっていた間の古い時刻で計算すると、再開した瞬間に大きな数字が一度出る
  const [, tick] = useState(0);
  useEffect(() => {
    if (!leavingAt) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [leavingAt]);
  return leavingAt ? Math.max(0, Math.ceil((Date.parse(leavingAt) - Date.now()) / 1000)) : 0;
}

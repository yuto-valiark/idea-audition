import { Mic, MicOff, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDisplay } from '../../store/display-store.ts';
import { useSession } from '../../store/session-store.ts';
import { judgeById, useMe } from '../../shared/selectors.ts';
import { useVoice } from './voice-store.ts';
import { useCall } from '../call/call-store.ts';
import styles from './Voice.module.css';

/**
 * 自分のマイク。既定はオン（みんなに声が届き、文字起こしもされる）。押すとミュートに切り替わる。
 */
export function MicButton() {
  const state = useVoice((s) => s.state);
  const inCall = useCall((s) => s.inCall);
  const muted = useCall((s) => s.muted);
  const toggleMute = useCall((s) => s.toggleMute);
  const join = useCall((s) => s.join);
  const listenOnly = useCall((s) => s.listenOnly);
  const retryMic = useCall((s) => s.retryMic);
  const on = inCall && !muted && !listenOnly;
  return (
    <button
      className={styles.mic}
      data-state={on ? (state === 'off' ? 'listening' : state) : 'off'}
      onClick={() => {
        if (!inCall) {
          if (muted) toggleMute();
          void join();
          return;
        }
        // 聞くだけで参加しているときは、マイクの許可を取り直してつなぎ直す
        if (listenOnly) {
          void retryMic();
          return;
        }
        toggleMute();
      }}
      aria-pressed={on}
      aria-label={on ? 'ミュートする' : 'ミュートを解除する'}
      title={on ? 'ミュートする（声がみんなにも AI にも届かなくなります）' : 'ミュートを解除する（キャラの名前を呼ぶと、そのキャラ宛てになります）'}
    >
      {on ? <Mic size={16} /> : <MicOff size={16} />}
    </button>
  );
}

/** 他の審査員のマイク状態 */
export function MicIndicator({ judgeId }: { judgeId: string }) {
  const on = useDisplay((s) => !!s.micOn[judgeId]);
  if (!on) return null;
  return (
    <span className={styles.bars} aria-label="マイクON">
      <i />
      <i />
      <i />
    </span>
  );
}

/** 発言のテキスト入力（音声が使えないときの代わり、常に使える） */
export function UtteranceInput() {
  const send = useSession((s) => s.send);
  const snapshot = useSession((s) => s.snapshot);
  const selected = useDisplay((s) => s.selected);
  const interim = useVoice((s) => s.interim);
  const voiceState = useVoice((s) => s.state);
  const { isSpectator } = useMe();
  const [text, setText] = useState('');
  const composing = useRef(false);
  const sending = useRef(false);
  const spotId = snapshot?.spotlight?.instanceId ?? null;
  const targetName = (selected ?? spotId) && snapshot ? snapshot.characters[(selected ?? spotId)!]?.name : null;
  const listening = voiceState === 'listening' || voiceState === 'starting';

  return (
    <form
      className={styles.input}
      data-listening={listening || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        // 日本語入力の変換確定の Enter と、送信中の二度押しでは送らない（同じ発言が2回出ないように）
        if (!t || composing.current || sending.current) return;
        sending.current = true;
        setText('');
        void send('SUBMIT_UTTERANCE', { text: t, source: 'text', ...(selected ? { targetInstanceId: selected } : {}) })
          .then((r) => {
            if (!r.ok) setText((cur) => cur || t);
          })
          .finally(() => {
            sending.current = false;
          });
      }}
    >
      {listening && interim ? (
        <span className={styles.interim} aria-live="polite">
          {interim}
        </span>
      ) : (
        <input
          value={text}
          maxLength={300}
          disabled={isSpectator}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          placeholder={
            listening
              ? '話してください…（キャラの名前を呼ぶと宛先になります）'
              : targetName
                ? `${targetName} に話しかける（質問・改善の指示）`
                : '発言する（「ルナ、コストを下げて」のように名前で呼べます）'
          }
          aria-label="発言"
        />
      )}
      <button disabled={isSpectator || !text.trim() || (listening && !!interim)} aria-label="送信">
        <Send size={15} />
      </button>
    </form>
  );
}

/** 審査員の発言を全員に表示する字幕 */
export function Captions() {
  const captions = useDisplay((s) => s.captions);
  return (
    <div className={styles.captions} aria-live="polite">
      {captions.map((c) => (
        <CaptionItem key={c.id} id={c.id} />
      ))}
    </div>
  );
}

const INTENT_LABEL = { question: '質問', instruction: '改善の指示', reject: '見送り', hesitation: '迷い', positive: 'いいね', comment: '' } as const;

function CaptionItem({ id }: { id: string }) {
  const caption = useDisplay((s) => s.captions.find((c) => c.id === id));
  const dismiss = useDisplay((s) => s.dismissCaption);
  const snapshot = useSession((s) => s.snapshot);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 6000);
    return () => clearTimeout(t);
  }, [id, dismiss]);
  if (!caption || !snapshot) return null;
  const judge = judgeById(snapshot, caption.judgeId);
  const target = caption.targetInstanceId ? snapshot.characters[caption.targetInstanceId]?.name : null;
  return (
    <div className={styles.caption} style={{ ['--judge' as string]: judge?.color ?? '#c58cff' }}>
      <b>
        {judge?.label ?? '審査員'}
        {target ? ` → ${target}` : ''}
      </b>
      {INTENT_LABEL[caption.intent] && <em>{INTENT_LABEL[caption.intent]}</em>}
      <span>{caption.text}</span>
      {caption.corrections?.length ? (
        <small title="会議の語彙（キャラ名・企画名・論点）に合わせて聞き間違いを直しました">
          （{caption.corrections.map((c) => `${c.from}→${c.to}`).join('、')} に補正）
        </small>
      ) : null}
      {caption.source === 'live' && <small>🎙</small>}
    </div>
  );
}

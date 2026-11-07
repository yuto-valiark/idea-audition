import { DEFAULT_ACTOR_CONFIG, SessionActor } from './application/session-actor.ts';
import type { IdeaGenerationPort, SessionStorePort, SpeechTranscriptionPort } from './application/ports.ts';
import { FixtureGateway } from './infrastructure/fixture/fixture-gateway.ts';
import { GeminiGateway } from './infrastructure/gemini/gemini-gateway.ts';
import { createVertexClient, geminiConfigFromEnv } from './infrastructure/gemini/client.ts';
import { ResilientGateway } from './infrastructure/resilient-gateway.ts';
import { nodeScheduler, randomIds, systemClock } from './infrastructure/runtime.ts';
import { FirestoreSessionStore } from './infrastructure/persistence/firestore-store.ts';
import { NoopSessionStore } from './infrastructure/persistence/memory-store.ts';
import { startServer, type ActorRegistry } from './presentation/ws-server.ts';
import { createVoiceServer } from './presentation/voice-server.ts';
import { GeminiLiveTranscriber } from './infrastructure/gemini/live-transcriber.ts';

const log = (m: string, extra?: unknown) =>
  console.log(`[${new Date().toISOString()}] ${m}`, ...(extra === undefined ? [] : [extra]));

const env = (key: string, fallback: string) => process.env[key] ?? fallback;

function createGateway(): IdeaGenerationPort {
  const fixture = new FixtureGateway(Number(env('FIXTURE_LATENCY_MS', '900')));
  const kind = env('AI_GATEWAY', 'fixture');
  if (kind === 'fixture') return fixture;
  if (kind !== 'gemini') {
    log(`AI_GATEWAY=${kind} は不明です。fixture を使います。`);
    return fixture;
  }
  const config = geminiConfigFromEnv(process.env);
  log(`AI: gemini (fast=${config.fast.model}/${config.fast.thinkingLevel}, refine=${config.refine.model}/${config.refine.thinkingLevel}), fallback=fixture`);
  // 失敗したら固定データで応答し、デモを止めない
  return new ResilientGateway(new GeminiGateway(createVertexClient(process.env), config, log), fixture, log);
}

function createStore(): SessionStorePort {
  const kind = env('PERSISTENCE', 'none');
  if (kind === 'firestore') {
    log('persistence: firestore');
    return FirestoreSessionStore.fromEnv(process.env);
  }
  if (kind !== 'none') log(`PERSISTENCE=${kind} は不明です。保存しません。`);
  return new NoopSessionStore();
}

/** 音声入力は Gemini 利用時のみ。使えないときはクライアントがテキスト入力に切り替える */
function createTranscriber(): SpeechTranscriptionPort | null {
  if (env('AI_GATEWAY', 'fixture') !== 'gemini' || env('VOICE', 'on') === 'off') return null;
  const model = env('GEMINI_LIVE_MODEL', 'gemini-3.5-transcribe-live');
  const location = env('GEMINI_LIVE_LOCATION', 'global');
  log(`voice: ${model} @ ${location}`);
  return new GeminiLiveTranscriber(createVertexClient(process.env, location), model, log);
}

const ai = createGateway();
const transcriber = createTranscriber();
const store = createStore();
const config = {
  ...DEFAULT_ACTOR_CONFIG,
  lowerRotationMs: Number(env('LOWER_ROTATION_MS', String(DEFAULT_ACTOR_CONFIG.lowerRotationMs))),
};
const ids = randomIds();

/**
 * セッションはメモリ上のアクターが保持する（ADR-0003、Cloud Run max-instances=1 前提）。
 * 初回アクセス時に保存先から復元する。全員が切断しても一定時間はメモリに残す。
 */
const actors = new Map<string, { actor: Promise<SessionActor>; releaseTimer?: NodeJS.Timeout }>();
const IDLE_RELEASE_MS = 30 * 60_000;

const registry: ActorRegistry = {
  get(sessionId) {
    let entry = actors.get(sessionId);
    if (!entry) {
      // 同時に来た接続が同じアクターを共有できるよう、Promise ごと保持する
      const actor = SessionActor.open(sessionId, {
        ai,
        store,
        scheduler: nodeScheduler,
        clock: systemClock,
        ids,
        config,
        log,
      });
      entry = { actor };
      actors.set(sessionId, entry);
      log(`session opened: ${sessionId} (ai=${ai.name}, store=${store.name})`);
      actor.catch(() => actors.delete(sessionId));
    }
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
    return entry.actor;
  },
  release(sessionId) {
    const entry = actors.get(sessionId);
    if (!entry) return;
    entry.releaseTimer = setTimeout(() => {
      void entry.actor.then((a) => a.dispose());
      actors.delete(sessionId);
      log(`session released: ${sessionId}`);
    }, IDLE_RELEASE_MS);
  },
};

// 終了時（Cloud Run の入れ替え・デプロイ）に未保存のイベントを書き出す
process.on('SIGTERM', async () => {
  log('SIGTERM: saving sessions');
  await Promise.allSettled([...actors.values()].map((e) => e.actor.then((a) => a.persist())));
  process.exit(0);
});

// Cloud Run は PORT を渡す。開発時は HIP_PORT で固定する（PORT が別用途で設定されていても衝突しない）
startServer({
  port: Number(process.env.HIP_PORT ?? env('PORT', '8787')),
  registry,
  voice: createVoiceServer({ registry, transcriber, log }),
  log,
});

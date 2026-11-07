import { DEFAULT_ACTOR_CONFIG, SessionActor } from './application/session-actor.ts';
import type { IdeaGenerationPort } from './application/ports.ts';
import { FixtureGateway } from './infrastructure/fixture/fixture-gateway.ts';
import { GeminiGateway } from './infrastructure/gemini/gemini-gateway.ts';
import { createVertexClient, geminiConfigFromEnv } from './infrastructure/gemini/client.ts';
import { ResilientGateway } from './infrastructure/resilient-gateway.ts';
import { noopEventLog, nodeScheduler, randomIds, systemClock } from './infrastructure/runtime.ts';
import { startServer, type ActorRegistry } from './presentation/ws-server.ts';

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

const ai = createGateway();
const config = {
  ...DEFAULT_ACTOR_CONFIG,
  lowerRotationMs: Number(env('LOWER_ROTATION_MS', String(DEFAULT_ACTOR_CONFIG.lowerRotationMs))),
};
const ids = randomIds();

/**
 * セッションはメモリ上のアクターが保持する（ADR-0003、Cloud Run max-instances=1 前提）。
 * 全員が切断しても一定時間はアクターを残し、再接続で同じ状態に戻れるようにする。
 */
const actors = new Map<string, { actor: SessionActor; releaseTimer?: NodeJS.Timeout }>();
const IDLE_RELEASE_MS = 30 * 60_000;

const registry: ActorRegistry = {
  get(sessionId) {
    let entry = actors.get(sessionId);
    if (!entry) {
      entry = {
        actor: new SessionActor(sessionId, {
          ai,
          eventLog: noopEventLog,
          scheduler: nodeScheduler,
          clock: systemClock,
          ids,
          config,
          log,
        }),
      };
      actors.set(sessionId, entry);
      log(`session created: ${sessionId} (ai=${ai.name})`);
    }
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
    return entry.actor;
  },
  release(sessionId) {
    const entry = actors.get(sessionId);
    if (!entry) return;
    entry.releaseTimer = setTimeout(() => {
      entry.actor.dispose();
      actors.delete(sessionId);
      log(`session released: ${sessionId}`);
    }, IDLE_RELEASE_MS);
  },
};

// Cloud Run は PORT を渡す。開発時は HIP_PORT で固定する（PORT が別用途で設定されていても衝突しない）
startServer({ port: Number(process.env.HIP_PORT ?? env('PORT', '8787')), registry, log });

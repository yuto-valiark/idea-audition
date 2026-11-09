import { describe, expect, it } from 'vitest';
import { CAMP_VERSION, type CommandMessage } from '@idea-audition/protocol';
import { SessionActor } from '../src/application/session-actor.ts';
import { GeminiLiveTranscriber } from '../src/infrastructure/gemini/live-transcriber.ts';
import { MemorySessionStore } from '../src/infrastructure/persistence/memory-store.ts';
import { StubAi, fakeClock, fakeConnection, manualScheduler, seqIds } from './helpers.ts';

describe('音声認識の語彙', () => {
  it('キャラ名（英字とカタカナ）・テーマ・ステージ上の企画名・操作の言葉が入る', async () => {
    const { scheduler, advance } = manualScheduler();
    const actor = new SessionActor('v', {
      ai: new StubAi(), store: new MemorySessionStore(), scheduler, clock: fakeClock(), ids: seqIds(),
      config: { stockTarget: 3, lowerSlotCount: 5, rotation: null, critiqueIntervalMs: 1000, persistDelayMs: 50, consensus: null },
    });
    const a = fakeConnection('a');
    actor.attach(a.conn, { camp: CAMP_VERSION, kind: 'hello', sessionId: 'v' });
    actor.receiveCommand(a.conn, { camp: CAMP_VERSION, kind: 'command', type: 'START_AUDITION', commandId: 'c1', sentAt: '', payload: { theme: 'DevFest ハッカソン作品', mode: 'team' } } as CommandMessage);
    await advance(0);
    const vocab = actor.speechVocabulary();
    expect(vocab).toEqual(expect.arrayContaining(['LUNA', 'ルナ', 'SPROUT', 'スプラウト', 'DevFest ハッカソン作品', '却下', 'Gemini']));
    const title = actor.session.ideaOf(actor.session.lowerSlots[0]!)!.revisions[0]!.title;
    expect(vocab).toContain(title);
    expect(vocab.length).toBeLessThanOrEqual(60);
    expect(new Set(vocab).size).toBe(vocab.length);
  });

  it('Live には日本語の指定と語彙を渡す', async () => {
    let config: Record<string, unknown> | undefined;
    const fakeAi = {
      live: {
        connect: async (p: { config: Record<string, unknown> }) => {
          config = p.config;
          return { sendRealtimeInput() {}, close() {} };
        },
      },
    };
    const t = new GeminiLiveTranscriber(fakeAi as never, 'm');
    await t.open({ onInterim() {}, onFinal() {}, onClose() {} }, { vocabulary: ['ルナ'] });
    expect(config!.inputAudioTranscription).toEqual({ languageCodes: ['ja-JP'], customVocabulary: ['ルナ'] });
  });
});

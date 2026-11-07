import {
  CHARACTER_DESIGNS,
  HIP_VERSION,
  LOWER_SLOT_COUNT,
  type CommandMessage,
  type CommandResultMessage,
  type EphemeralMessage,
  type EventMessage,
  type HelloMessage,
  type RejectReason,
  type ServerMessage,
} from '@idea-audition/protocol';
import { AuditionSession } from '../domain/session.ts';
import type { Clock, DomainEvent, DomainResult, IdProvider, SessionState } from '../domain/types.ts';
import type { IdeaGenerationPort, RefineOutput, Scheduler, SessionStorePort, StoredEvent } from './ports.ts';
import { toSnapshot } from './projection.ts';

export interface Connection {
  readonly id: string;
  send(message: ServerMessage): void;
}

export interface ActorConfig {
  /** 発表待ちストックの目標件数（ADR-0005 §3） */
  stockTarget: number;
  /** 下段の自動入れ替え間隔。0 で無効 */
  lowerRotationMs: number;
  /** 相互批評の吹き出しを順に出す間隔（読める速さ、AC-27） */
  critiqueIntervalMs: number;
  /** 確定イベントをまとめて保存するまでの待ち時間 */
  persistDelayMs: number;
}

export const DEFAULT_ACTOR_CONFIG: ActorConfig = {
  stockTarget: 3,
  lowerRotationMs: 30_000,
  critiqueIntervalMs: 2_200,
  persistDelayMs: 300,
};

interface Deps {
  ai: IdeaGenerationPort;
  store: SessionStorePort;
  scheduler: Scheduler;
  clock: Clock;
  ids: IdProvider;
  config: ActorConfig;
  log?: (msg: string, extra?: unknown) => void;
}

type RefineTrigger =
  | { kind: 'promotion'; instanceId: string }
  | { kind: 'instruction'; instanceId: string; text: string };

const QUESTION_PATTERN = /[?？]\s*$|どう|なぜ|なに|何|どれ|いくら|ですか|ますか|できる/;
const RESULT_CACHE_LIMIT = 500;
const PERSIST_RETRY_MS = 5_000;

/**
 * セッションごとのアクター（ADR-0003）。
 * コマンドは Node.js のイベントループ上で1件ずつ同期的に処理される。
 * AI 呼び出しの完了も同じ経路で状態に反映されるため、ロックは不要。
 */
export class SessionActor {
  readonly session: AuditionSession;
  private seq = 0;
  private connections = new Map<string, { conn: Connection; judgeId: string | null }>();
  private results = new Map<string, CommandResultMessage>();
  private held = new Map<string, string>(); // judgeId → instanceId（ドラッグ中）
  private generating = false;
  private refineQueue: RefineTrigger[] = [];
  private refining = false;
  private stopRotation: (() => void) | null = null;
  private pendingTimers = new Set<() => void>();
  /** start / reset のたびに増やし、古い非同期結果を捨てる */
  private epoch = 0;
  private unsaved: StoredEvent[] = [];
  private saving = false;
  private saveScheduled = false;

  constructor(
    sessionId: string,
    private readonly deps: Deps,
    restored?: { seq: number; state: SessionState },
  ) {
    const domainDeps = { ids: deps.ids, clock: deps.clock };
    if (restored) {
      this.session = AuditionSession.fromState(sessionId, restored.state, domainDeps);
      this.seq = restored.seq;
    } else {
      this.session = new AuditionSession(sessionId, domainDeps);
    }
  }

  /**
   * 保存済みの状態があれば復元してアクターを作る（サーバー再起動後の再開、ADR-0003）。
   * 読み込みに失敗しても、新しいセッションとして動かす。
   */
  static async open(sessionId: string, deps: Deps): Promise<SessionActor> {
    let restored: { seq: number; state: SessionState } | null = null;
    try {
      restored = await deps.store.load(sessionId);
    } catch (e) {
      deps.log?.(`session load failed (${deps.store.name}): ${sessionId}`, e);
    }
    const actor = new SessionActor(sessionId, deps, restored ?? undefined);
    if (restored) {
      deps.log?.(`session restored: ${sessionId} seq=${restored.seq} status=${restored.state.status}`);
      if (actor.session.status === 'audition_active') actor.onStarted();
    }
    return actor;
  }

  get connectionCount() {
    return this.connections.size;
  }

  /* --------------------------- 接続・切断 --------------------------- */

  attach(conn: Connection, hello: HelloMessage) {
    const joined = this.session.join(hello.judgeId);
    const judgeId = joined.ok ? joined.value.judgeId : null;
    this.connections.set(conn.id, { conn, judgeId });
    conn.send({ hip: HIP_VERSION, kind: 'welcome', judgeId, snapshot: toSnapshot(this.session, this.seq) });
    if (joined.ok) this.emit(joined.events, { actorJudgeId: judgeId });
  }

  detach(conn: Connection) {
    const entry = this.connections.get(conn.id);
    this.connections.delete(conn.id);
    if (!entry?.judgeId) return;
    const stillConnected = [...this.connections.values()].some((c) => c.judgeId === entry.judgeId);
    if (stillConnected) return;
    this.held.delete(entry.judgeId);
    this.relay(conn, { hip: HIP_VERSION, kind: 'ephemeral', type: 'CURSOR_MOVED', payload: null });
    const left = this.session.leave(entry.judgeId);
    if (left.ok) this.emit(left.events, { actorJudgeId: entry.judgeId });
  }

  dispose() {
    void this.persist();
    this.stopRotation?.();
    for (const cancel of this.pendingTimers) cancel();
    this.pendingTimers.clear();
  }

  /* ---------------------------- Ephemeral ---------------------------- */

  receiveEphemeral(conn: Connection, msg: EphemeralMessage) {
    const entry = this.connections.get(conn.id);
    if (!entry?.judgeId) return;
    if (msg.type === 'DRAG_PREVIEW') {
      if (msg.payload.instanceId) this.held.set(entry.judgeId, msg.payload.instanceId);
      else this.held.delete(entry.judgeId);
    }
    this.relay(conn, msg);
  }

  private relay(from: Connection, msg: EphemeralMessage) {
    const senderId = this.connections.get(from.id)?.judgeId;
    if (!senderId) return;
    const out: EphemeralMessage = { ...msg, senderId };
    for (const { conn } of this.connections.values()) if (conn.id !== from.id) conn.send(out);
  }

  /* ----------------------------- Command ----------------------------- */

  receiveCommand(conn: Connection, cmd: CommandMessage) {
    const entry = this.connections.get(conn.id);
    const judgeId = entry?.judgeId ?? null;
    const cacheKey = `${judgeId ?? conn.id}:${cmd.commandId}`;
    const cached = this.results.get(cacheKey);
    if (cached) {
      conn.send(cached); // 重複排除：同じ結果を返し、再実行しない（ADR-0004）
      return;
    }
    const result = judgeId ? this.execute(judgeId, cmd) : { ok: false as const, reason: 'SPECTATOR' as const };
    const message: CommandResultMessage = {
      hip: HIP_VERSION,
      kind: 'result',
      commandId: cmd.commandId,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
    };
    this.results.set(cacheKey, message);
    if (this.results.size > RESULT_CACHE_LIMIT) this.results.delete(this.results.keys().next().value!);
    conn.send(message);
  }

  private execute(judgeId: string, cmd: CommandMessage): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    const meta = { actorJudgeId: judgeId, correlationId: cmd.commandId };
    const apply = (r: DomainResult<unknown>) => {
      if (r.ok) this.emit(r.events, meta);
      return r.ok ? ({ ok: true } as const) : r;
    };

    switch (cmd.type) {
      case 'START_AUDITION': {
        const r = apply(s.start(cmd.payload.theme, cmd.payload.mode));
        if (r.ok) this.onStarted();
        return r;
      }
      case 'RESET_SESSION': {
        const r = apply(s.reset(judgeId));
        if (r.ok) this.onStopped();
        return r;
      }
      case 'REQUEST_PROMOTION': {
        const r = s.promote(cmd.payload.instanceId);
        if (!r.ok) return r;
        this.emit(r.events, meta);
        this.held.forEach((id, j) => id === cmd.payload.instanceId && this.held.delete(j));
        this.enqueueRefinement({ kind: 'promotion', instanceId: cmd.payload.instanceId });
        this.ensureStock();
        return { ok: true };
      }
      case 'NEXT_IDEA': {
        const r = apply(s.rotate(cmd.payload.instanceId, this.heldIds()));
        this.ensureStock();
        return r;
      }
      case 'ASK_CANDIDATE':
        return this.ask(judgeId, cmd.payload.instanceId, cmd.payload.text, meta);
      case 'REQUEST_REFINEMENT': {
        if (s.status !== 'audition_active') return { ok: false, reason: 'SESSION_NOT_ACTIVE' };
        if (!s.finalist(cmd.payload.instanceId)) return { ok: false, reason: 'NOT_IN_UPPER' };
        this.enqueueRefinement({ kind: 'instruction', instanceId: cmd.payload.instanceId, text: cmd.payload.text });
        return { ok: true };
      }
      case 'SUBMIT_UTTERANCE': {
        const { text, source, targetInstanceId } = cmd.payload;
        return this.receiveUtterance(judgeId, text, source, targetInstanceId ?? null, cmd.commandId);
      }
      case 'START_CHAMPION_VOTE':
        return apply(s.startVote(judgeId));
      case 'CAST_VOTE':
        return this.afterFinal(apply(s.castVote(judgeId, cmd.payload.instanceId)));
      case 'CLOSE_VOTE':
        return this.afterFinal(apply(s.closeVote(judgeId)));
      case 'RESOLVE_TIE':
        return this.afterFinal(apply(s.resolveTie(judgeId, cmd.payload.instanceId)));
      case 'SELECT_CHAMPION':
        return this.afterFinal(apply(s.selectChampion(judgeId, cmd.payload.instanceId)));
    }
  }

  /**
   * 審査員の発言（音声の文字起こし、またはテキスト入力）。
   * 宛先は「発言に含まれるキャラ名」→「詳細を開いていたキャラ」の順に決める。
   * 質問なら回答だけ、上段キャラへの指示なら改良を依頼する（AC-14）。
   */
  receiveUtterance(
    judgeId: string,
    text: string,
    source: 'live' | 'text',
    fallbackTargetId: string | null,
    correlationId?: string,
  ): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    if (!s.judges.some((j) => j.judgeId === judgeId)) return { ok: false, reason: 'SPECTATOR' };
    const meta = { actorJudgeId: judgeId, correlationId: correlationId ?? this.deps.ids.next('utt') };
    const targetInstanceId = this.findAddressee(text) ?? (fallbackTargetId && s.characters.has(fallbackTargetId) ? fallbackTargetId : null);
    const isQuestion = QUESTION_PATTERN.test(text);
    const willRefine = !!targetInstanceId && !isQuestion && !!s.finalist(targetInstanceId) && s.status === 'audition_active';
    this.emit(
      [
        {
          type: 'JUDGE_UTTERANCE_RECEIVED',
          detail: { judgeId, text, source, targetInstanceId, intent: targetInstanceId ? (willRefine ? 'instruction' : 'question') : 'comment' },
        },
      ],
      meta,
    );
    if (!targetInstanceId) return { ok: true };
    if (willRefine) {
      this.enqueueRefinement({ kind: 'instruction', instanceId: targetInstanceId, text });
      return { ok: true };
    }
    const target = s.characters.get(targetInstanceId);
    if (target?.location === 'archived') return { ok: true };
    return this.ask(judgeId, targetInstanceId, text, meta);
  }

  /** 発言の中にステージ上のキャラ名（英字名か読み）があれば、そのキャラを宛先にする */
  private findAddressee(text: string): string | null {
    const s = this.session;
    const onStage = [...s.lowerSlots.filter((x): x is string => x !== null), ...s.upper.map((f) => f.instanceId)];
    let best: { id: string; index: number } | null = null;
    const lower = text.toLowerCase();
    for (const id of onStage) {
      const design = CHARACTER_DESIGNS[s.characters.get(id)!.designId]!;
      for (const word of [design.name.toLowerCase(), ...design.readings]) {
        const index = lower.indexOf(word);
        if (index >= 0 && (!best || index < best.index)) best = { id, index };
      }
    }
    return best?.id ?? null;
  }

  isJudge(judgeId: string) {
    return this.session.judges.some((j) => j.judgeId === judgeId);
  }

  private afterFinal<R extends { ok: boolean }>(r: R): R {
    if (this.session.status === 'completed') this.onStopped();
    return r;
  }

  private ask(
    judgeId: string,
    instanceId: string,
    question: string,
    meta: { actorJudgeId: string; correlationId: string },
  ): { ok: true } | { ok: false; reason: RejectReason } {
    const s = this.session;
    const r = s.ask(judgeId, instanceId, question);
    if (!r.ok) return r;
    this.emit(r.events, meta);
    const idea = s.ideaOf(instanceId)!;
    const rev = s.currentRevision(idea.ideaId);
    const epoch = this.epoch;
    const name = this.characterName(instanceId);
    this.deps.ai
      .answer({ theme: s.theme, idea: { title: rev.title, summary: rev.summary }, characterName: name, question })
      .catch((e) => {
        this.deps.log?.('answer failed', e);
        return 'ごめんなさい、いまうまく答えられませんでした。もう一度聞いてください。';
      })
      .then((text) => {
        if (epoch !== this.epoch) return;
        this.emit(s.fillAnswer(r.value.answerId, text), { actorJudgeId: null, correlationId: meta.correlationId });
      });
    return { ok: true };
  }

  /* ------------------------ 下段：生成と入れ替え ------------------------ */

  private onStarted() {
    this.epoch++;
    this.refineQueue = [];
    this.refining = false;
    this.ensureStock();
    this.stopRotation?.();
    if (this.deps.config.lowerRotationMs > 0) {
      this.stopRotation = this.deps.scheduler.setInterval(() => this.rotateOldest(), this.deps.config.lowerRotationMs);
    }
  }

  private onStopped() {
    this.epoch++;
    this.stopRotation?.();
    this.stopRotation = null;
    this.refineQueue = [];
    this.refining = false;
    for (const cancel of this.pendingTimers) cancel();
    this.pendingTimers.clear();
  }

  private rotateOldest() {
    if (this.session.status !== 'audition_active') return;
    const r = this.session.rotate(undefined, this.heldIds());
    if (r.ok) this.emit(r.events, { actorJudgeId: null });
    this.ensureStock();
  }

  private heldIds() {
    return new Set(this.held.values());
  }

  /** 空き枠＋目標ストック件数になるまで先読み生成する（ADR-0005 §3） */
  private ensureStock() {
    const s = this.session;
    if (s.status !== 'audition_active' || this.generating) return;
    const empty = s.lowerSlots.filter((x) => x === null).length;
    const need = empty + this.deps.config.stockTarget - s.stock.length;
    if (need <= 0) return;
    this.generating = true;
    const epoch = this.epoch;
    const avoidTitles = [...s.ideas.values()].map((i) => i.revisions[0]!.title).concat(s.stock.map((d) => d.title));
    this.deps.ai
      .generateIdeas({ theme: s.theme, count: Math.min(need, LOWER_SLOT_COUNT + 3), avoidTitles })
      .then((drafts) => {
        if (epoch !== this.epoch) return;
        s.addToStock(drafts);
        this.emit(s.fillEmptySlots(), { actorJudgeId: null });
      })
      .catch((e) => this.deps.log?.('generateIdeas failed', e))
      .finally(() => {
        if (epoch !== this.epoch) return;
        this.generating = false;
        // 失敗時の連続呼び出しを避けるため、少し待ってから再確認する
        this.later(() => this.ensureStock(), 1500);
      });
  }

  /* -------------------------- 上段：改良と批評 -------------------------- */

  private enqueueRefinement(t: RefineTrigger) {
    this.refineQueue.push(t);
    this.pumpRefinement();
  }

  private pumpRefinement() {
    if (this.refining) return;
    const s = this.session;
    let trigger = this.refineQueue.shift();
    while (trigger && !s.finalist(trigger.instanceId)) trigger = this.refineQueue.shift();
    if (!trigger || s.status !== 'audition_active') return;

    const others = s.upper.filter((f) => f.instanceId !== trigger.instanceId);
    // 新しい上段キャラの加入時は全員で相互批評（Q3）。待っている他の昇格もまとめて扱う。
    const isArrival = trigger.kind === 'promotion' && others.length > 0;
    if (isArrival) this.refineQueue = this.refineQueue.filter((t) => t.kind !== 'promotion');
    const participantIds = isArrival ? s.upper.map((f) => f.instanceId) : [trigger.instanceId];
    const rounds = isArrival ? (participantIds.length >= 3 ? 3 : 2) : 0;
    const base = new Map(participantIds.map((id) => [id, s.currentRevision(s.ideaOf(id)!.ideaId)]));

    this.refining = true;
    const epoch = this.epoch;
    this.emit(s.setFinalistStatus(participantIds, 'refining'), { actorJudgeId: null });

    this.deps.ai
      .refine({
        theme: s.theme,
        trigger: isArrival ? 'arrival' : trigger.kind,
        participants: participantIds.map((id) => ({
          instanceId: id,
          characterName: this.characterName(id),
          title: base.get(id)!.title,
          summary: base.get(id)!.summary,
          version: base.get(id)!.version,
        })),
        targets: participantIds,
        rounds,
        instruction: trigger.kind === 'instruction' ? trigger.text : null,
      })
      .then(
        (out) => epoch === this.epoch && this.presentRefinement(participantIds, base, out),
        (e) => {
          this.deps.log?.('refine failed', e);
          if (epoch !== this.epoch) return;
          this.emit(s.setFinalistStatus(participantIds, 'ready'), { actorJudgeId: null });
          this.finishRefinement();
        },
      );
  }

  /** 批評 → 改良版の公開を、全員が同じタイミングで見られるようサーバー側で順に出す */
  private presentRefinement(ids: string[], base: Map<string, { revisionId: string }>, out: RefineOutput) {
    const s = this.session;
    const critiques = out.critiques.filter((c) => ids.includes(c.fromInstanceId) && ids.includes(c.toInstanceId));
    if (critiques.length > 0) s.setFinalistStatus(ids, 'critiquing');
    const step = this.deps.config.critiqueIntervalMs;
    const epoch = this.epoch;

    critiques.forEach((c, i) => {
      this.later(() => {
        if (epoch !== this.epoch) return;
        this.emit(s.postCritique(c), { actorJudgeId: null });
      }, i * step);
    });

    this.later(() => {
      if (epoch !== this.epoch) return;
      const events: DomainEvent[] = [];
      for (const id of ids) {
        const draft = out.revisions[id];
        const baseRev = base.get(id);
        if (!draft || !baseRev) continue;
        const r = s.publishRevision(id, baseRev.revisionId, draft);
        if (r.ok) events.push(...r.events);
        else this.deps.log?.(`revision discarded (${r.reason})`, { id });
      }
      events.push(...s.setFinalistStatus(ids, 'ready'));
      this.emit(events, { actorJudgeId: null });
      this.finishRefinement();
    }, critiques.length * step);
  }

  private finishRefinement() {
    this.refining = false;
    this.pumpRefinement();
  }

  /* ------------------------------ 共通 ------------------------------ */

  private characterName(instanceId: string) {
    const c = this.session.characters.get(instanceId);
    return c ? (CHARACTER_DESIGNS[c.designId]?.name ?? 'AI') : 'AI';
  }

  private later(fn: () => void, ms: number) {
    const cancel = this.deps.scheduler.setTimeout(() => {
      this.pendingTimers.delete(cancel);
      fn();
    }, ms);
    this.pendingTimers.add(cancel);
  }

  private emit(events: DomainEvent[], meta: { actorJudgeId: string | null; correlationId?: string }) {
    if (events.length === 0) return;
    const messages: EventMessage[] = events.map((e) => ({
      hip: HIP_VERSION,
      kind: 'event',
      type: e.type,
      seq: ++this.seq,
      correlationId: meta.correlationId ?? null,
      actorJudgeId: meta.actorJudgeId,
      detail: e.detail,
      snapshot: undefined as never,
    }));
    // 同じバッチのイベントはすべて、バッチ適用後の snapshot を持つ
    const snapshot = toSnapshot(this.session, this.seq);
    const at = new Date(this.deps.clock.now()).toISOString();
    for (const m of messages) {
      m.snapshot = snapshot;
      this.unsaved.push({
        seq: m.seq,
        type: m.type,
        detail: m.detail,
        actorJudgeId: m.actorJudgeId,
        correlationId: m.correlationId,
        at,
      });
      for (const { conn } of this.connections.values()) conn.send(m);
    }
    this.schedulePersist();
  }

  /* ------------------------------ 永続化 ------------------------------ */

  /** 配信は保存を待たない。少し待ってまとめて書く（ADR-0003 Decision 2） */
  private schedulePersist() {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    this.deps.scheduler.setTimeout(() => {
      this.saveScheduled = false;
      void this.persist();
    }, this.deps.config.persistDelayMs);
  }

  /** テスト・終了時用：未保存のイベントを今すぐ書く */
  async persist(): Promise<void> {
    if (this.saving) {
      this.schedulePersist();
      return;
    }
    if (this.unsaved.length === 0) return;
    this.saving = true;
    const events = this.unsaved;
    this.unsaved = [];
    let failed = false;
    try {
      await this.deps.store.commit(this.session.sessionId, this.seq, this.session.toState(), events);
    } catch (e) {
      // 失敗してもデモは止めない。次の保存で一緒に書けるよう戻し、少し間をあけて再試行する
      failed = true;
      this.unsaved = [...events, ...this.unsaved];
      this.deps.log?.(`session save failed (${this.deps.store.name}): ${this.session.sessionId}`, e);
    } finally {
      this.saving = false;
      if (failed) this.later(() => void this.persist(), PERSIST_RETRY_MS);
      else if (this.unsaved.length > 0) this.schedulePersist();
    }
  }
}

import {
  type ProposalContent,
  type AiMode,
  CHARACTER_DESIGNS,
  LOWER_SLOT_COUNT,
  MAX_JUDGES,
  UPPER_CAPACITY,
  type SessionMode,
  type SessionStatus,
} from '@idea-audition/protocol';
import { pickDesign } from './character-allocation.ts';
import { applyOps, emptyLedger, recomputeStatuses, type ApplyResult, type Ledger, type LedgerOp } from './consensus.ts';
import {
  DEFAULT_ROTATION_POLICY,
  addAttention,
  detectMention,
  newAttention,
  pickExitCandidate,
  type AttentionKind,
  type RotationPolicy,
} from './attention.ts';
import {
  ok,
  reject,
  type Answer,
  type ArchivedIdea,
  type CharacterInstance,
  type Clock,
  type Critique,
  type DomainEvent,
  type DomainResult,
  type Finalist,
  type Idea,
  type IdeaDraft,
  type IdProvider,
  type Judge,
  type Revision,
  type RevisionDraft,
  type DecisionRecord,
  type UtteranceRecord,
  type SessionState,
  type Proposal,
  type Vote,
} from './types.ts';

const RECENT_DESIGN_MEMORY = 3;
const MAX_UTTERANCES_KEPT = 200;
const MAX_DECISIONS_KEPT = 100;
const MAX_CRITIQUES_KEPT = 24;
const MAX_ANSWERS_KEPT = 30;

/**
 * オーディションセッションの集約。サーバー権威の判定はすべてここで行う（ADR-0003）。
 *
 * 不変条件（acceptance-criteria §5）
 * - lowerSlots は長さ5。補充前の一時的な null は許容
 * - upper は 0〜3
 * - 1つの instanceId は lower / upper / archived のどれか1つ
 *   （'promoting' は同期処理の中で完結するため、MVPでは外部に現れない）
 * - 改良は新しい Revision を追加するだけで、既存の Revision は変更しない
 */
export class AuditionSession {
  status: SessionStatus = 'lobby';
  mode: SessionMode = 'team';
  theme = '';
  lowerSlots: (string | null)[] = Array.from({ length: LOWER_SLOT_COUNT }, () => null);
  upper: Finalist[] = [];
  characters = new Map<string, CharacterInstance>();
  ideas = new Map<string, Idea>();
  critiques: Critique[] = [];
  answers: Answer[] = [];
  ideaBox: ArchivedIdea[] = [];
  judges: Judge[] = [];
  vote: Vote | null = null;
  champion: { instanceId: string; ideaId: string; revisionId: string } | null = null;
  /** 発表待ちのアイデア（先読みストック、ADR-0005 §3） */
  stock: IdeaDraft[] = [];

  /** 合意台帳と、その材料（発言・行動）。ADR-0007 */
  ledger: Ledger = emptyLedger();
  utterances: UtteranceRecord[] = [];
  decisions: DecisionRecord[] = [];
  /** 台帳に反映済みの最後の発言 seq */
  ledgerCursor = 0;
  /** 優勝案の企画書（優勝が決まると作り始める） */
  proposal: Proposal | null = null;
  startedAt: number | null = null;
  /** AI のモード。セッションごとに選べる（固定データなら Gemini のクレジットを使わない） */
  aiMode: AiMode = 'fixture';
  /** このサーバーで選べるモード（アクターが設定する。保存しない） */
  aiAvailable: AiMode[] = ['fixture'];

  /** 下段の入れ替え方（アクターが設定する） */
  rotationPolicy: RotationPolicy = DEFAULT_ROTATION_POLICY;

  private recentlyDeparted: number[] = [];
  private designLastUsedAt = new Map<number, number>();

  constructor(
    readonly sessionId: string,
    private readonly deps: { ids: IdProvider; clock: Clock },
  ) {}

  /* --------------------------- 保存と復元 --------------------------- */

  /** 永続化用の状態（JSONにできる形）。復元は fromState。 */
  toState(): SessionState {
    return {
      schemaVersion: 1,
      status: this.status,
      mode: this.mode,
      theme: this.theme,
      lowerSlots: [...this.lowerSlots],
      upper: this.upper.map((f) => ({ ...f })),
      characters: [...this.characters.values()].map((c) => ({ ...c })),
      ideas: [...this.ideas.values()].map((i) => structuredClone(i)),
      critiques: this.critiques.map((c) => ({ ...c })),
      answers: this.answers.map((a) => ({ ...a })),
      ideaBox: this.ideaBox.map((a) => ({ ...a })),
      judges: this.judges.map((j) => ({ ...j })),
      vote: this.vote ? { ...this.vote, ballots: [...this.vote.ballots.entries()] } : null,
      champion: this.champion ? { ...this.champion } : null,
      stock: this.stock.map((d) => ({ ...d })),
      recentlyDeparted: [...this.recentlyDeparted],
      designLastUsedAt: [...this.designLastUsedAt.entries()],
      ledger: structuredClone(this.ledger),
      utterances: this.utterances.map((u) => ({ ...u })),
      decisions: this.decisions.map((d) => ({ ...d })),
      ledgerCursor: this.ledgerCursor,
      proposal: this.proposal ? structuredClone(this.proposal) : null,
      startedAt: this.startedAt,
      aiMode: this.aiMode,
    };
  }

  /**
   * 保存した状態から復元する。サーバー再起動後は全員が切断した扱いにし、
   * 途中だった改良（処理中のAI呼び出しは失われている）は「準備完了」に戻す。
   */
  static fromState(
    sessionId: string,
    state: SessionState,
    deps: { ids: IdProvider; clock: Clock },
  ): AuditionSession {
    const s = new AuditionSession(sessionId, deps);
    s.status = state.status;
    s.mode = state.mode;
    s.theme = state.theme;
    s.lowerSlots = [...state.lowerSlots];
    s.upper = state.upper.map((f) => ({ ...f, status: 'ready' }));
    s.characters = new Map(
      state.characters.map((c) => [
        c.instanceId,
        // 注目度は後から追加した項目。古い保存データには無いので初期値を入れる。退場予告は取り消す
        { ...c, attention: c.attention ?? newAttention(c.spawnedAt), leavingAt: null },
      ]),
    );
    s.ideas = new Map(state.ideas.map((i) => [i.ideaId, structuredClone(i)]));
    s.critiques = state.critiques.map((c) => ({ ...c }));
    s.answers = state.answers.map((a) => ({ ...a, answer: a.answer ?? '（サーバー再起動のため回答できませんでした）' }));
    s.ideaBox = state.ideaBox.map((a) => ({ ...a }));
    s.judges = state.judges.map((j) => ({ ...j, connected: false, isHost: false }));
    s.vote = state.vote ? { ...state.vote, ballots: new Map(state.vote.ballots) } : null;
    s.champion = state.champion ? { ...state.champion } : null;
    s.stock = state.stock.map((d) => ({ ...d }));
    s.recentlyDeparted = [...state.recentlyDeparted];
    s.designLastUsedAt = new Map(state.designLastUsedAt);
    s.ledger = state.ledger ? structuredClone(state.ledger) : emptyLedger();
    s.utterances = state.utterances?.map((u) => ({ ...u })) ?? [];
    s.decisions = state.decisions?.map((d) => ({ ...d })) ?? [];
    s.ledgerCursor = state.ledgerCursor ?? 0;
    s.proposal = state.proposal ? structuredClone(state.proposal) : null;
    s.startedAt = state.startedAt ?? null;
    if (state.aiMode) s.aiMode = state.aiMode;
    return s;
  }

  /* ------------------------------ 参加者 ------------------------------ */

  join(requestedJudgeId?: string): DomainResult<{ judgeId: string | null }> {
    const now = this.deps.clock.now();
    const existing = requestedJudgeId
      ? this.judges.find((j) => j.judgeId === requestedJudgeId)
      : undefined;
    const events: DomainEvent[] = [];
    let judge: Judge | undefined = existing;

    if (judge) {
      judge.connected = true;
    } else {
      if (this.judges.length >= MAX_JUDGES) {
        // 切断済みの審査員の枠を空ける。全員接続中なら観覧モード。
        const stale = this.judges.filter((j) => !j.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (!stale) return ok([], { judgeId: null });
        this.judges = this.judges.filter((j) => j !== stale);
      }
      const used = new Set(this.judges.map((j) => j.slotIndex));
      const slotIndex = [0, 1, 2, 3].find((i) => !used.has(i))!;
      judge = {
        judgeId: this.deps.ids.next('judge'),
        slotIndex,
        isHost: false,
        connected: true,
        joinedAt: now,
      };
      this.judges.push(judge);
    }
    events.push({ type: 'JUDGE_JOINED', detail: { judgeId: judge.judgeId, reconnected: !!existing } });
    events.push(...this.ensureHost());
    return ok(events, { judgeId: judge.judgeId });
  }

  leave(judgeId: string): DomainResult {
    const judge = this.judges.find((j) => j.judgeId === judgeId);
    if (!judge) return ok([]);
    judge.connected = false;
    const events: DomainEvent[] = [{ type: 'JUDGE_LEFT', detail: { judgeId } }];
    if (judge.isHost) {
      judge.isHost = false;
      events.push(...this.ensureHost());
    }
    if (this.vote?.status === 'open') events.push(...this.closeVoteIfEveryoneVoted());
    return ok(events);
  }

  private ensureHost(): DomainEvent[] {
    if (this.judges.some((j) => j.isHost && j.connected)) return [];
    for (const j of this.judges) j.isHost = false;
    const next = this.judges.filter((j) => j.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return [];
    next.isHost = true;
    return [{ type: 'HOST_CHANGED', detail: { judgeId: next.judgeId } }];
  }

  private isHost(judgeId: string) {
    return this.judges.some((j) => j.judgeId === judgeId && j.isHost);
  }

  /* ---------------------------- セッション ---------------------------- */

  start(theme: string, mode: SessionMode, aiMode?: AiMode): DomainResult {
    if (this.status !== 'lobby' && this.status !== 'completed') return reject('SESSION_NOT_ACTIVE');
    this.clearBoard();
    this.theme = theme;
    this.mode = mode;
    if (aiMode && this.aiAvailable.includes(aiMode)) this.aiMode = aiMode;
    this.status = 'audition_active';
    this.startedAt = this.deps.clock.now();
    return ok([{ type: 'SESSION_STARTED', detail: { theme, mode } }]);
  }

  reset(judgeId: string): DomainResult {
    if (!this.isHost(judgeId)) return reject('NOT_HOST');
    this.clearBoard();
    this.status = 'lobby';
    this.theme = '';
    return ok([{ type: 'SESSION_RESET', detail: {} }]);
  }

  private clearBoard() {
    this.lowerSlots = Array.from({ length: LOWER_SLOT_COUNT }, () => null);
    this.upper = [];
    this.characters.clear();
    this.ideas.clear();
    this.critiques = [];
    this.answers = [];
    this.ideaBox = [];
    this.vote = null;
    this.champion = null;
    this.stock = [];
    this.recentlyDeparted = [];
    this.designLastUsedAt.clear();
    this.ledger = emptyLedger();
    this.utterances = [];
    this.decisions = [];
    this.ledgerCursor = 0;
    this.proposal = null;
    this.startedAt = null;
  }

  /* ------------------------------ 下段 ------------------------------ */

  addToStock(drafts: IdeaDraft[]) {
    if (this.status !== 'audition_active') return;
    this.stock.push(...drafts);
  }

  /** 空いている下段の枠を、ストックから補充する（AC-02） */
  fillEmptySlots(): DomainEvent[] {
    if (this.status !== 'audition_active') return [];
    const events: DomainEvent[] = [];
    for (let slot = 0; slot < this.lowerSlots.length; slot++) {
      if (this.lowerSlots[slot] !== null) continue;
      const draft = this.stock.shift();
      if (!draft) break;
      const designId = pickDesign({
        designIds: CHARACTER_DESIGNS.map((d) => d.designId),
        onStage: this.designsOnStage(),
        recentlyDeparted: this.recentlyDeparted,
        lastUsedAt: this.designLastUsedAt,
      });
      if (designId === null) {
        this.stock.unshift(draft);
        break;
      }
      const now = this.deps.clock.now();
      const idea: Idea = {
        ideaId: this.deps.ids.next('idea'),
        revisions: [
          {
            revisionId: this.deps.ids.next('rev'),
            version: 1,
            title: draft.title,
            summary: draft.summary,
            icon: draft.icon,
            keepStrengths: [],
            improvementPoints: [],
            basedOnRevisionId: null,
            reason: null,
            createdAt: now,
            basedOnConsensus: draft.basedOnConsensus ?? null,
            inspiredBy: draft.inspiredBy ?? null,
          },
        ],
      };
      const character: CharacterInstance = {
        instanceId: this.deps.ids.next('ch'),
        designId,
        location: 'lower',
        ideaId: idea.ideaId,
        spawnedAt: now,
        attention: newAttention(now),
        leavingAt: null,
      };
      this.ideas.set(idea.ideaId, idea);
      this.characters.set(character.instanceId, character);
      this.lowerSlots[slot] = character.instanceId;
      this.designLastUsedAt.set(designId, now);
      events.push({
        type: 'CANDIDATE_SPAWNED',
        detail: { instanceId: character.instanceId, slot, designId },
      });
    }
    return events;
  }

  /** 下段の1体を退場させ、案を Idea BOX へ保存して入れ替える */
  rotate(
    instanceId?: string,
    exclude: ReadonlySet<string> = new Set(),
    opts: { reason?: 'rotated' | 'rejected'; byJudgeId?: string | null; allowEmpty?: boolean } = {},
  ): DomainResult {
    if (this.status !== 'audition_active') return reject('SESSION_NOT_ACTIVE');
    // 自動の入れ替えは次の案が無いと行わない。見送りは空き枠（準備中）になっても退場させる
    if (this.stock.length === 0 && !opts.allowEmpty) return ok([]);
    const targetId =
      instanceId ??
      this.lowerSlots
        .filter((id): id is string => id !== null && !exclude.has(id))
        .sort((a, b) => this.characters.get(a)!.spawnedAt - this.characters.get(b)!.spawnedAt)[0];
    if (!targetId) return ok([]);
    const character = this.characters.get(targetId);
    if (!character) return reject('UNKNOWN_CHARACTER');
    const slot = this.lowerSlots.indexOf(targetId);
    if (character.location !== 'lower' || slot < 0) return reject('NOT_IN_LOWER');

    character.location = 'archived';
    character.leavingAt = null;
    this.lowerSlots[slot] = null;
    this.rememberDeparture(character.designId);
    this.ideaBox.push({
      ideaId: character.ideaId,
      instanceId: character.instanceId,
      designId: character.designId,
      reason: opts.reason ?? 'rotated',
      archivedAt: this.deps.clock.now(),
    });
    return ok([
      {
        type: 'CANDIDATE_ARCHIVED',
        detail: { instanceId: targetId, slot, reason: opts.reason ?? 'rotated', byJudgeId: opts.byJudgeId ?? null },
      },
      ...this.fillEmptySlots(),
    ]);
  }

  /* ---------------------------- 注目度と入れ替え ---------------------------- */

  /** 触れられた（カーソル・詳細・つかむ・質問・会話）。退場予告中なら取り消す */
  touch(instanceId: string, kind: AttentionKind): DomainEvent[] {
    const c = this.characters.get(instanceId);
    if (!c || c.location === 'archived') return [];
    c.attention = addAttention(c.attention, kind, this.deps.clock.now(), this.rotationPolicy);
    if (c.leavingAt === null) return [];
    c.leavingAt = null;
    return [{ type: 'CANDIDATE_STAYED', detail: { instanceId } }];
  }

  /** 見られている間（カーソルが乗っている・詳細を開いている）は「触れられていない時間」を進めない */
  keepAlive(instanceId: string) {
    const c = this.characters.get(instanceId);
    if (c) c.attention = { ...c.attention, lastTouchAt: this.deps.clock.now() };
  }

  /**
   * 発言の中でステージ上のどの案が取り上げられたかを調べ、注目度に加える。
   * 名前で呼ばれた案、企画名の一部が出た案の順に強く数える。
   */
  registerUtterance(text: string): { events: DomainEvent[]; mentioned: string[] } {
    const events: DomainEvent[] = [];
    const mentioned: string[] = [];
    const onStage = [...this.lowerSlots.filter((x): x is string => x !== null), ...this.upper.map((f) => f.instanceId)];
    for (const id of onStage) {
      const c = this.characters.get(id)!;
      const design = CHARACTER_DESIGNS[c.designId]!;
      const kind = detectMention(text, { ...design, title: this.currentRevision(c.ideaId).title }, this.theme);
      if (!kind) continue;
      mentioned.push(id);
      events.push(...this.touch(id, kind === 'name' ? 'mentionName' : 'mentionTitle'));
    }
    return { events, mentioned };
  }

  /** 退場させる下段の案を選ぶ（attention.ts の方針） */
  pickExitCandidate(protectedIds: ReadonlySet<string>, ignoreIdle = false): string | null {
    const candidates = this.lowerSlots
      .filter((id): id is string => id !== null)
      .map((id) => this.characters.get(id)!)
      .filter((c) => c.leavingAt === null);
    return pickExitCandidate(candidates, this.deps.clock.now(), protectedIds, this.rotationPolicy, ignoreIdle);
  }

  /** 退場予告。warningMs 後に退場する（その間に触れられたら取り消し） */
  beginLeaving(instanceId: string, warningMs: number): DomainEvent[] {
    const c = this.characters.get(instanceId);
    if (!c || c.location !== 'lower') return [];
    c.leavingAt = this.deps.clock.now() + warningMs;
    return [{ type: 'CANDIDATE_LEAVING', detail: { instanceId, leavingAt: new Date(c.leavingAt).toISOString() } }];
  }

  /** 退場予告をすべて取り消す（誰もいなくなったとき） */
  cancelAllLeaving() {
    for (const c of this.characters.values()) c.leavingAt = null;
  }

  /** 退場予告中の案（複数同時にあり得る） */
  leavingCandidates(): { instanceId: string; leavingAt: number }[] {
    return this.lowerSlots
      .map((id) => (id ? this.characters.get(id) : undefined))
      .filter((c): c is CharacterInstance => c?.leavingAt != null)
      .map((c) => ({ instanceId: c.instanceId, leavingAt: c.leavingAt! }));
  }

  /** 審査員による「見送り」：下段の案をすぐ退場させ、次のキャラと交代する */
  rejectCandidate(judgeId: string, instanceId: string): DomainResult {
    if (this.status !== 'audition_active') return reject('SESSION_NOT_ACTIVE');
    const c = this.characters.get(instanceId);
    if (!c) return reject('UNKNOWN_CHARACTER');
    if (c.location !== 'lower') return reject('NOT_IN_LOWER');
    return this.rotate(instanceId, new Set(), { reason: 'rejected', byJudgeId: judgeId, allowEmpty: true });
  }

  /* ---------------------------- 合意台帳（ADR-0007） ---------------------------- */

  recordUtterance(u: UtteranceRecord) {
    this.utterances = [...this.utterances, u].slice(-MAX_UTTERANCES_KEPT);
  }

  recordDecision(kind: DecisionRecord['kind'], instanceId: string, judgeId: string | null) {
    const c = this.characters.get(instanceId);
    if (!c) return;
    const title = this.currentRevision(c.ideaId).title;
    this.decisions = [...this.decisions, { kind, instanceId, title, judgeId, at: this.deps.clock.now() }].slice(
      -MAX_DECISIONS_KEPT,
    );
  }

  /** まだ台帳に反映していない発言 */
  pendingUtterances(): UtteranceRecord[] {
    return this.utterances.filter((u) => u.seq > this.ledgerCursor);
  }

  /**
   * 台帳に op を当てはめる。合意の母数は「参加した審査員の数」（切断で状態が揺れないように）。
   * uptoSeq：今回の材料にした最後の発言（次回はそれより後だけを渡す）
   */
  applyLedgerOps(ops: LedgerOp[], uptoSeq: number | null): ApplyResult & { events: DomainEvent[] } {
    const result = applyOps(this.ledger, ops, {
      now: this.deps.clock.now(),
      connectedJudges: Math.max(1, this.judges.length),
      newId: () => this.deps.ids.next('claim'),
      validJudgeIds: new Set(this.judges.map((j) => j.judgeId)),
    });
    this.ledger = result.ledger;
    if (uptoSeq !== null) this.ledgerCursor = Math.max(this.ledgerCursor, uptoSeq);
    const events: DomainEvent[] =
      result.applied.length > 0
        ? [
            {
              type: 'CONSENSUS_UPDATED',
              detail: { version: this.ledger.version, ops: result.applied.map((o) => o.op), statusChanges: result.statusChanges },
            },
          ]
        : [];
    return { ...result, events };
  }

  /** 審査員が増減したら合意の母数が変わるので状態を計算し直す */
  refreshLedgerStatuses() {
    this.ledger = recomputeStatuses(this.ledger, Math.max(1, this.judges.length));
  }

  /* ----------------------------- AI のモード ----------------------------- */

  /** AI のモードを切り替える。ホストのみ（ソロは本人がホスト）。選べないモードは拒否 */
  setAiMode(judgeId: string, mode: AiMode): DomainResult {
    if (!this.isHost(judgeId)) return reject('NOT_HOST');
    if (!this.aiAvailable.includes(mode)) return reject('NOT_AUTHORIZED');
    if (this.aiMode === mode) return ok([]);
    this.aiMode = mode;
    return ok([{ type: 'AI_MODE_CHANGED', detail: { mode } }]);
  }

  /* ------------------------------ 企画書 ------------------------------ */

  finishProposal(content: ProposalContent, generatedBy: string): DomainEvent[] {
    if (!this.champion || !this.proposal) return [];
    this.proposal = { status: 'ready', content, generatedAt: this.deps.clock.now(), generatedBy };
    return [{ type: 'PROPOSAL_UPDATED', detail: { status: 'ready' } }];
  }

  failProposal(): DomainEvent[] {
    if (!this.proposal) return [];
    this.proposal = { ...this.proposal, status: 'failed' };
    return [{ type: 'PROPOSAL_UPDATED', detail: { status: 'failed' } }];
  }

  /** 作り直し（失敗したとき、または作り直したいとき） */
  restartProposal(): DomainResult {
    if (!this.champion || this.status !== 'completed') return reject('SESSION_NOT_ACTIVE');
    if (this.proposal?.status === 'generating') return ok([]);
    this.proposal = { status: 'generating', content: null, generatedAt: null, generatedBy: null };
    return ok([{ type: 'PROPOSAL_UPDATED', detail: { status: 'generating' } }]);
  }

  /* ------------------------------ 昇格 ------------------------------ */

  /** キャラ本体のドラッグによる昇格（AC-05〜07, AC-31） */
  promote(instanceId: string): DomainResult<{ fromSlot: number }> {
    if (this.status !== 'audition_active') return reject('SESSION_NOT_ACTIVE');
    const character = this.characters.get(instanceId);
    if (!character) return reject('UNKNOWN_CHARACTER');
    const slot = this.lowerSlots.indexOf(instanceId);
    if (character.location !== 'lower' || slot < 0) return reject('NOT_IN_LOWER');
    if (this.upper.length >= UPPER_CAPACITY) return reject('UPPER_FULL');

    this.lowerSlots[slot] = null;
    character.location = 'upper';
    character.leavingAt = null;
    this.upper.push({ instanceId, status: 'refining' });
    this.rememberDeparture(character.designId);

    const events: DomainEvent[] = [
      {
        type: 'PROMOTION_CONFIRMED',
        detail: { instanceId, fromSlot: slot, upperIndex: this.upper.length - 1 },
      },
      ...this.fillEmptySlots(),
    ];
    return ok(events, { fromSlot: slot });
  }

  private rememberDeparture(designId: number) {
    this.recentlyDeparted = [designId, ...this.recentlyDeparted.filter((d) => d !== designId)].slice(
      0,
      RECENT_DESIGN_MEMORY,
    );
  }

  private designsOnStage(): Set<number> {
    const ids = [...this.lowerSlots.filter((x): x is string => x !== null), ...this.upper.map((f) => f.instanceId)];
    return new Set(ids.map((id) => this.characters.get(id)!.designId));
  }

  /* --------------------------- 上段の改良 --------------------------- */

  finalist(instanceId: string) {
    return this.upper.find((f) => f.instanceId === instanceId);
  }

  currentRevision(ideaId: string): Revision {
    const idea = this.ideas.get(ideaId)!;
    return idea.revisions[idea.revisions.length - 1]!;
  }

  ideaOf(instanceId: string): Idea | undefined {
    const c = this.characters.get(instanceId);
    return c ? this.ideas.get(c.ideaId) : undefined;
  }

  setFinalistStatus(instanceIds: string[], status: Finalist['status']): DomainEvent[] {
    const changed = this.upper.filter((f) => instanceIds.includes(f.instanceId));
    for (const f of changed) f.status = status;
    if (status !== 'refining' || changed.length === 0) return [];
    return [
      { type: 'FINALIST_REFINEMENT_STARTED', detail: { instanceIds: changed.map((f) => f.instanceId) } },
    ];
  }

  postCritique(c: Omit<Critique, 'critiqueId' | 'postedAt'>): DomainEvent[] {
    if (!this.finalist(c.fromInstanceId) || !this.finalist(c.toInstanceId)) return [];
    const critique: Critique = {
      ...c,
      critiqueId: this.deps.ids.next('crit'),
      postedAt: this.deps.clock.now(),
    };
    this.critiques = [...this.critiques, critique].slice(-MAX_CRITIQUES_KEPT);
    return [{ type: 'FINALIST_CRITIQUE_POSTED', detail: { ...critique } }];
  }

  /**
   * 改良版の公開。base が現在の版と一致しない、または上段にいない場合は破棄（ADR-0005 §5）。
   */
  publishRevision(instanceId: string, baseRevisionId: string, draft: RevisionDraft): DomainResult {
    if (this.status !== 'audition_active') return reject('SESSION_NOT_ACTIVE');
    const character = this.characters.get(instanceId);
    if (!character || !this.finalist(instanceId)) return reject('NOT_IN_UPPER');
    const idea = this.ideas.get(character.ideaId)!;
    const current = idea.revisions[idea.revisions.length - 1]!;
    if (current.revisionId !== baseRevisionId) return reject('STALE_VERSION');
    const revision: Revision = {
      revisionId: this.deps.ids.next('rev'),
      version: current.version + 1,
      title: draft.title,
      summary: draft.summary,
      icon: draft.icon ?? current.icon,
      keepStrengths: draft.keepStrengths,
      improvementPoints: draft.improvementPoints,
      basedOnRevisionId: current.revisionId,
      reason: draft.reason,
      createdAt: this.deps.clock.now(),
      basedOnConsensus: this.ledger.version,
      inspiredBy: draft.inspiredBy ?? null,
    };
    idea.revisions.push(revision);
    return ok([
      {
        type: 'FINALIST_VERSION_PUBLISHED',
        detail: { instanceId, ideaId: idea.ideaId, revisionId: revision.revisionId, version: revision.version },
      },
    ]);
  }

  /* ------------------------------ 深掘り ------------------------------ */

  ask(judgeId: string, instanceId: string, question: string): DomainResult<{ answerId: string }> {
    if (this.status === 'lobby') return reject('SESSION_NOT_ACTIVE');
    const c = this.characters.get(instanceId);
    if (!c) return reject('UNKNOWN_CHARACTER');
    const answer: Answer = {
      answerId: this.deps.ids.next('ans'),
      instanceId,
      judgeId,
      question,
      answer: null,
      askedAt: this.deps.clock.now(),
    };
    this.answers = [...this.answers, answer].slice(-MAX_ANSWERS_KEPT);
    return ok([{ type: 'CANDIDATE_ANSWERED', detail: { answerId: answer.answerId, pending: true } }], {
      answerId: answer.answerId,
    });
  }

  fillAnswer(answerId: string, text: string): DomainEvent[] {
    const a = this.answers.find((x) => x.answerId === answerId);
    if (!a) return [];
    a.answer = text;
    return [{ type: 'CANDIDATE_ANSWERED', detail: { answerId, pending: false } }];
  }

  /* ---------------------------- 投票・優勝 ---------------------------- */

  startVote(judgeId: string): DomainResult {
    if (this.status !== 'audition_active') return reject('SESSION_NOT_ACTIVE');
    if (!this.isHost(judgeId)) return reject('NOT_HOST');
    if (this.upper.length < 2) return reject('NOT_AUTHORIZED');
    this.status = 'champion_selection';
    this.vote = { status: 'open', ballots: new Map(), tally: null, tieInstanceIds: [] };
    return ok([{ type: 'CHAMPION_VOTE_STARTED', detail: {} }]);
  }

  castVote(judgeId: string, instanceId: string): DomainResult {
    if (this.vote?.status !== 'open') return reject('VOTE_NOT_OPEN');
    if (!this.finalist(instanceId)) return reject('NOT_IN_UPPER');
    this.vote.ballots.set(judgeId, instanceId);
    return ok([{ type: 'VOTE_CAST', detail: { judgeId } }, ...this.closeVoteIfEveryoneVoted()]);
  }

  closeVote(judgeId: string): DomainResult {
    if (this.vote?.status !== 'open') return reject('VOTE_NOT_OPEN');
    if (!this.isHost(judgeId)) return reject('NOT_HOST');
    return ok(this.tallyVote());
  }

  resolveTie(judgeId: string, instanceId: string): DomainResult {
    if (this.vote?.status !== 'tie') return reject('VOTE_NOT_OPEN');
    if (!this.isHost(judgeId)) return reject('NOT_HOST');
    if (!this.vote.tieInstanceIds.includes(instanceId)) return reject('NOT_A_TIE_CANDIDATE');
    return ok(this.crown(instanceId, 'tie_break'));
  }

  /** ソロ、または上段が1体だけのときの即決（Q4） */
  selectChampion(judgeId: string, instanceId: string): DomainResult {
    if (this.status !== 'audition_active') return reject('SESSION_NOT_ACTIVE');
    if (!this.finalist(instanceId)) return reject('NOT_IN_UPPER');
    const allowed = this.mode === 'solo' || (this.upper.length === 1 && this.isHost(judgeId));
    if (!allowed) return reject(this.isHost(judgeId) ? 'NOT_AUTHORIZED' : 'NOT_HOST');
    return ok(this.crown(instanceId, 'direct'));
  }

  private closeVoteIfEveryoneVoted(): DomainEvent[] {
    if (this.vote?.status !== 'open') return [];
    const connected = this.judges.filter((j) => j.connected);
    if (connected.length === 0) return [];
    // 未投票で切断した審査員は母数から外す（ADR-0003 §投票）
    const everyoneVoted = connected.every((j) => this.vote!.ballots.has(j.judgeId));
    return everyoneVoted ? this.tallyVote() : [];
  }

  private tallyVote(): DomainEvent[] {
    const vote = this.vote!;
    const tally: Record<string, number> = Object.fromEntries(this.upper.map((f) => [f.instanceId, 0]));
    for (const id of vote.ballots.values()) if (id in tally) tally[id] = (tally[id] ?? 0) + 1;
    vote.tally = tally;
    const max = Math.max(...Object.values(tally));
    const leaders = Object.keys(tally).filter((id) => tally[id] === max);
    if (leaders.length === 1) return this.crown(leaders[0]!, 'majority');
    vote.status = 'tie';
    vote.tieInstanceIds = leaders;
    return [{ type: 'TIE_DETECTED', detail: { instanceIds: leaders, tally } }];
  }

  private crown(instanceId: string, how: 'direct' | 'majority' | 'tie_break'): DomainEvent[] {
    const character = this.characters.get(instanceId)!;
    const revision = this.currentRevision(character.ideaId);
    this.champion = { instanceId, ideaId: character.ideaId, revisionId: revision.revisionId };
    if (this.vote) this.vote.status = 'closed';
    this.status = 'completed';
    this.stock = [];
    // 企画書は優勝と同時に作り始める（アクターが AI を呼ぶ）
    this.proposal = { status: 'generating', content: null, generatedAt: null, generatedBy: null };
    this.decisions = [
      ...this.decisions,
      { kind: 'champion', instanceId, title: revision.title, judgeId: null, at: this.deps.clock.now() },
    ];
    return [{ type: 'CHAMPION_SELECTED', detail: { instanceId, how, tally: this.vote?.tally ?? null } }];
  }
}

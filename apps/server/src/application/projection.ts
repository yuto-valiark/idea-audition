import { CHARACTER_DESIGNS, JUDGE_SLOTS, type SessionSnapshot } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';

const iso = (ms: number) => new Date(ms).toISOString();

/** ドメインの状態 → クライアント向けの投影（DTO は Entity と分ける、ADR-0002） */
export function toSnapshot(s: AuditionSession, seq: number): SessionSnapshot {
  return {
    sessionId: s.sessionId,
    seq,
    status: s.status,
    mode: s.mode,
    theme: s.theme,
    lowerSlots: [...s.lowerSlots],
    upper: s.upper.map((f) => ({ ...f })),
    characters: Object.fromEntries(
      [...s.characters.values()].map((c) => {
        const design = CHARACTER_DESIGNS[c.designId]!;
        return [
          c.instanceId,
          {
            instanceId: c.instanceId,
            designId: c.designId,
            name: design.name,
            accent: design.accent,
            location: c.location,
            ideaId: c.ideaId,
            mentions: c.attention.mentions,
            leavingAt: c.leavingAt === null ? null : iso(c.leavingAt),
          },
        ];
      }),
    ),
    ideas: Object.fromEntries(
      [...s.ideas.values()].map((i) => [
        i.ideaId,
        {
          ideaId: i.ideaId,
          revisions: i.revisions.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
        },
      ]),
    ),
    critiques: s.critiques.map((c) => ({ ...c, postedAt: iso(c.postedAt) })),
    answers: s.answers.map((a) => ({ ...a, askedAt: iso(a.askedAt) })),
    ideaBox: s.ideaBox.map((a) => ({
      ideaId: a.ideaId,
      designId: a.designId,
      characterName: CHARACTER_DESIGNS[a.designId]!.name,
      reason: a.reason,
      archivedAt: iso(a.archivedAt),
    })),
    judges: s.judges
      .slice()
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((j) => ({
        judgeId: j.judgeId,
        label: JUDGE_SLOTS[j.slotIndex]!.label,
        color: JUDGE_SLOTS[j.slotIndex]!.color,
        isHost: j.isHost,
        connected: j.connected,
        joinedAt: iso(j.joinedAt),
      })),
    vote: s.vote
      ? {
          status: s.vote.status,
          votedJudgeIds: [...s.vote.ballots.keys()],
          tally: s.vote.status === 'open' ? null : s.vote.tally,
          tieInstanceIds: s.vote.tieInstanceIds,
        }
      : null,
    champion: s.champion,
  };
}

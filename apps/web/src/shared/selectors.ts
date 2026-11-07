import type { RevisionView, SessionSnapshot } from '@idea-audition/protocol';
import { useSession } from '../store/session-store.ts';

/** zustand のセレクターで新しい配列を毎回返すと無限再描画になるため、空配列は共有する */
export const EMPTY: readonly never[] = Object.freeze([]);

export function currentRevision(s: SessionSnapshot, instanceId: string): RevisionView | null {
  const c = s.characters[instanceId];
  const idea = c ? s.ideas[c.ideaId] : undefined;
  return idea ? idea.revisions[idea.revisions.length - 1]! : null;
}

export function originalRevision(s: SessionSnapshot, instanceId: string): RevisionView | null {
  const c = s.characters[instanceId];
  return c ? (s.ideas[c.ideaId]?.revisions[0] ?? null) : null;
}

export function useMe() {
  const judgeId = useSession((s) => s.judgeId);
  const judges = useSession((s) => s.snapshot?.judges ?? EMPTY);
  const me = judges.find((j) => j.judgeId === judgeId) ?? null;
  return { judgeId, me, isHost: !!me?.isHost, isSpectator: judgeId === null };
}

export function judgeById(s: SessionSnapshot, judgeId: string) {
  return s.judges.find((j) => j.judgeId === judgeId) ?? null;
}

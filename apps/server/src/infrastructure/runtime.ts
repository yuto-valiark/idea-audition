import { randomBytes } from 'node:crypto';
import type { Clock, IdProvider } from '../domain/types.ts';
import type { EventLogPort, Scheduler } from '../application/ports.ts';

export const systemClock: Clock = { now: () => Date.now() };

export function randomIds(): IdProvider {
  const salt = randomBytes(3).toString('hex');
  let n = 0;
  return { next: (prefix) => `${prefix}_${salt}${(++n).toString(36)}` };
}

export const nodeScheduler: Scheduler = {
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  setInterval(fn, ms) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

/** Day 2 で Firestore 実装に置き換える（ADR-0003） */
export const noopEventLog: EventLogPort = { append() {} };

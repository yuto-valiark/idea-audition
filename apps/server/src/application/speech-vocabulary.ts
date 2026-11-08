import { CHARACTER_DESIGNS } from '@idea-audition/protocol';
import type { AuditionSession } from '../domain/session.ts';

/**
 * 音声認識に渡す語彙（Gemini Live の customVocabulary）。
 * キャラ名・テーマ・いま出ている企画名・操作の言葉を渡すと、聞き間違いが減る
 * （合成音声での比較：「ルナ」→「のの」、「スプラウト」→「ブラウト」が正しくなった）。
 */
const COMMAND_WORDS = ['却下', 'パス', '見送り', '賛成', '反対', '決勝', '最終オーディション', 'いいね', 'うーん'];
const TECH_WORDS = ['Gemini', 'Google', 'Cloud Run', 'Firebase', 'AI', 'アプリ'];
const MAX_PHRASES = 60;
const MAX_PHRASE_CHARS = 30;

export function speechVocabulary(s: AuditionSession): string[] {
  const names = CHARACTER_DESIGNS.flatMap((d) => [d.name, ...d.readings.filter((r) => /[ァ-ヶー]/.test(r))]);
  const onStage = [...s.lowerSlots.filter((x): x is string => !!x), ...s.upper.map((f) => f.instanceId)];
  const titles = onStage
    .map((id) => s.ideaOf(id)?.revisions.at(-1)?.title)
    .filter((t): t is string => !!t);
  const theme = s.theme ? [s.theme.slice(0, MAX_PHRASE_CHARS)] : [];
  const claims = s.ledger.claims.filter((c) => c.status !== 'superseded').map((c) => c.text);
  const all = [...names, ...theme, ...titles, ...claims, ...COMMAND_WORDS, ...TECH_WORDS]
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= MAX_PHRASE_CHARS);
  return [...new Set(all)].slice(0, MAX_PHRASES);
}

/** HIP の核（どのアプリでも使える部分）。将来は別パッケージに切り出す（ADR-0010 §5） */
export * from './core/index.ts';
/** IDEA AUDITION の言葉（Command・Event の一覧と、snapshot の形） */
export * from './vocabulary/model.ts';
export * from './vocabulary/messages.ts';
export * from './vocabulary/reasons.ts';
export * from './vocabulary/characters.ts';
export * from './vocabulary/voice.ts';
export * from './vocabulary/proposal.ts';
export * from './vocabulary/taste.ts';

/**
 * キャラ素材のカタログ（web の描画とサーバーの割当ての両方が参照する静的データ）。
 * 素材：apps/web/public/assets/characters/mascots.png（4列×2行のスプライト、reference/mock-app 由来）
 * Q2 の目標は 12〜16 体。追加したらここに行を足す。
 */
export interface CharacterDesign {
  designId: number;
  name: string;
  accent: string;
  /** スプライト上の位置 */
  sprite: { sheet: string; col: number; row: number; cols: number; rows: number };
}

const SHEET = '/assets/characters/mascots.png';

export const CHARACTER_DESIGNS: readonly CharacterDesign[] = [
  ['MOMO', '#f367ff'],
  ['SPROUT', '#56e8ca'],
  ['LUNA', '#748aff'],
  ['POPO', '#ffa46d'],
  ['NOVA', '#76dfff'],
  ['RIO', '#50baff'],
  ['LEO', '#ffc85c'],
  ['MIST', '#bc85ff'],
].map(([name, accent], i) => ({
  designId: i,
  name: name!,
  accent: accent!,
  sprite: { sheet: SHEET, col: i % 4, row: Math.floor(i / 4), cols: 4, rows: 2 },
}));

export const JUDGE_SLOTS = [
  { label: '審査員 A', color: '#c58cff' },
  { label: '審査員 B', color: '#f367ff' },
  { label: '審査員 C', color: '#55c7ff' },
  { label: '審査員 D', color: '#ffc85c' },
] as const;

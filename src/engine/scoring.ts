import { COLS, SPECIAL_RANKS, type Rank } from './cards';

export const INVALID_HAND_SCORE = 9999;

/**
 * Scores a 10-card play area laid out as two rows of five.
 * `grid` is indexed row-major: 0-4 is row 1, 5-9 is row 2.
 *
 * Rules (section 12 of game-description.md):
 *  - A column whose two cards share a rank scores 0, unless that rank is 7, 11 or 13.
 *  - Otherwise add each card's value, counting 7, 11 and 13 as 0.
 *  - Each 2x2 square of identical ranks subtracts 10. Squares are counted left to
 *    right and a column may be used by at most one counted square.
 *  - A malformed hand scores 9999.
 */
export function scoreGrid(grid: readonly (Rank | null | undefined)[]): number {
  if (grid.length !== 10 || grid.some((r) => r == null)) return INVALID_HAND_SCORE;
  const ranks = grid as readonly Rank[];

  let score = 0;
  for (let col = 0; col < COLS; col++) {
    const top = ranks[col];
    const bottom = ranks[col + COLS];
    if (top === bottom && !SPECIAL_RANKS.has(top)) continue;
    if (!SPECIAL_RANKS.has(top)) score += top;
    if (!SPECIAL_RANKS.has(bottom)) score += bottom;
  }

  // 2x2 squares, greedy left to right, no column reused. Special ranks DO count here.
  const used = new Array(COLS).fill(false);
  for (let col = 0; col < COLS - 1; col++) {
    if (used[col] || used[col + 1]) continue;
    const a = ranks[col];
    if (a === ranks[col + 1] && a === ranks[col + COLS] && a === ranks[col + 1 + COLS]) {
      score -= 10;
      used[col] = true;
      used[col + 1] = true;
    }
  }
  return score;
}

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
export interface ColumnBreakdown {
  col: number;
  top: Rank;
  bottom: Rank;
  /** A matching non-special pair, which cancels the column to zero. */
  cancelled: boolean;
  /** True where that card is a 7, 11 or Skip-Bo and so counts as zero. */
  topIsZero: boolean;
  bottomIsZero: boolean;
  /** What this column contributed before square bonuses. */
  points: number;
}

export interface SquareBreakdown {
  /** Left column of the 2x2; it spans this column and the next. */
  leftCol: number;
  rank: Rank;
}

export interface ScoreBreakdown {
  valid: boolean;
  columns: ColumnBreakdown[];
  squares: SquareBreakdown[];
  /** Sum of the column points, before squares. */
  base: number;
  /** Total taken off by squares; negative or zero. */
  squareBonus: number;
  total: number;
}

/**
 * Scores a hand and shows its working.
 *
 * `scoreGrid` is defined in terms of this, so the explanation shown to a
 * player can never disagree with the score they were awarded.
 */
export function scoreBreakdown(grid: readonly (Rank | null | undefined)[]): ScoreBreakdown {
  if (grid.length !== 10 || grid.some((r) => r == null)) {
    return {
      valid: false,
      columns: [],
      squares: [],
      base: INVALID_HAND_SCORE,
      squareBonus: 0,
      total: INVALID_HAND_SCORE,
    };
  }
  const ranks = grid as readonly Rank[];

  const columns: ColumnBreakdown[] = [];
  let base = 0;
  for (let col = 0; col < COLS; col++) {
    const top = ranks[col];
    const bottom = ranks[col + COLS];
    const topIsZero = SPECIAL_RANKS.has(top);
    const bottomIsZero = SPECIAL_RANKS.has(bottom);
    const cancelled = top === bottom && !topIsZero;
    const points = cancelled ? 0 : (topIsZero ? 0 : top) + (bottomIsZero ? 0 : bottom);
    base += points;
    columns.push({ col, top, bottom, cancelled, topIsZero, bottomIsZero, points });
  }

  // 2x2 squares, greedy left to right, no column reused. Special ranks DO count here.
  const squares: SquareBreakdown[] = [];
  const used = new Array(COLS).fill(false);
  for (let col = 0; col < COLS - 1; col++) {
    if (used[col] || used[col + 1]) continue;
    const a = ranks[col];
    if (a === ranks[col + 1] && a === ranks[col + COLS] && a === ranks[col + 1 + COLS]) {
      squares.push({ leftCol: col, rank: a });
      used[col] = true;
      used[col + 1] = true;
    }
  }
  const squareBonus = -10 * squares.length;

  return { valid: true, columns, squares, base, squareBonus, total: base + squareBonus };
}

export function scoreGrid(grid: readonly (Rank | null | undefined)[]): number {
  return scoreBreakdown(grid).total;
}

/** Ranks 1-12 are ordinary cards; 13 is the Skip-Bo card. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** Ranks that count as 0 when scoring and never cancel as a column pair. */
export const SPECIAL_RANKS: ReadonlySet<Rank> = new Set<Rank>([7, 11, 13]);

export const SKIP_BO_RANK: Rank = 13;

/** A physical card. `id` is a stable identity used by the UI for animation. */
export interface Card {
  readonly rank: Rank;
  readonly id: number;
}

export const DECK_SIZE = 162;
export const GRID_SIZE = 10;
export const COLS = 5;
export const ROWS = 2;

/** 12 copies of each rank 1-12, plus 18 Skip-Bo cards. 162 total. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let rank = 1; rank <= 12; rank++) {
    for (let i = 0; i < 12; i++) deck.push({ rank: rank as Rank, id: id++ });
  }
  for (let i = 0; i < 18; i++) deck.push({ rank: SKIP_BO_RANK, id: id++ });
  return deck;
}

export const idx = (row: number, col: number): number => row * COLS + col;
export const rowOf = (i: number): number => Math.floor(i / COLS);
export const colOf = (i: number): number => i % COLS;
/** The spot in the same column, other row - the target of a wave. */
export const oppositeOf = (i: number): number => idx(1 - rowOf(i), colOf(i));

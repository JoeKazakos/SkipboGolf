import type { Card } from './cards';

export interface Slot {
  card: Card;
  faceUp: boolean;
}

export interface PlayerState {
  /** Exactly 10 slots, row-major: 0-4 is row 1, 5-9 is row 2. */
  grid: Slot[];
  /** Last element is the top of the pile. */
  discard: Card[];
}

export type DrawSource =
  | { kind: 'center' }
  | { kind: 'pile' }
  | { kind: 'discard'; player: number };

export type Action =
  | { type: 'draw'; source: DrawSource }
  | { type: 'place'; spot: number }
  | { type: 'discard' };

export type Phase = 'draw' | 'act';

export interface GameState {
  players: PlayerState[];
  drawPile: Card[];
  /** The face-up centre card; null once taken. Never replaced. */
  centerCard: Card | null;
  current: number;
  /** The card in hand during the 'act' phase. */
  held: Card | null;
  phase: Phase;
  /** Per-turn: a spot may be placed into at most once (section 15.1). */
  locked: boolean[];
  placements: number;
  /** Player who first reached 10 face-up cards, or null. */
  triggerPlayer: number | null;
  /** Turns still owed in the final cycle once the round end has triggered. */
  finalTurnsRemaining: number | null;
  terminal: boolean;
  rngState: number;
  turnCount: number;
}

/** What one player can legally see of the table. */
export interface Observation {
  viewer: number;
  players: {
    /** null where the card is face down and hidden from the viewer. */
    grid: ({ rank: number; faceUp: true } | { faceUp: false })[];
    discardTop3: Card[];
    discardCount: number;
  }[];
  centerCard: Card | null;
  drawPileCount: number;
  current: number;
  held: Card | null;
  phase: Phase;
  locked: boolean[];
  placements: number;
  triggerPlayer: number | null;
  terminal: boolean;
}

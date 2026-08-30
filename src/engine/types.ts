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
  /** The face-up center card; null once taken. Never replaced. */
  centerCard: Card | null;
  current: number;
  /** The card in hand during the 'act' phase. */
  held: Card | null;
  /**
   * Whether everyone knows the rank of the held card.
   *
   * True for every draw - the center card, a discard top, and a card taken
   * from the face-down pile, which is turned face up as it is taken
   * (section 15.14) - and for a card displaced out of a face-up spot.
   *
   * False only for a card displaced out of a FACE-DOWN spot during a wave:
   * that one is revealed to the player who lifted it and to nobody else.
   */
  heldIsPublic: boolean;
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
  /**
   * What the player to move is holding, as this viewer is entitled to see it.
   * `null` when nobody is holding anything; `{ card: null }` when they hold
   * something whose rank this viewer does not know.
   */
  heldByCurrent: { card: Card | null } | null;
  phase: Phase;
  locked: boolean[];
  placements: number;
  triggerPlayer: number | null;
  terminal: boolean;
}

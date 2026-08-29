import { COLS, SPECIAL_RANKS, colOf, rowOf, type Rank } from '../engine/cards';
import type { Action, GameState, Observation } from '../engine/types';

export type ObservedGrid = Observation['players'][number]['grid'];

/** The ten grid ranks as the viewer sees them; null where a card is face down. */
export function visibleRanks(grid: ObservedGrid): (number | null)[] {
  return grid.map((slot) => ('rank' in slot ? slot.rank : null));
}

export const HUMAN = 0;

/** Seat 0 is always the human; seats 1..5 are named by the chosen opponents. */
export type SeatNames = readonly string[];

export const PLAYER_NAMES: SeatNames = ['You', 'Ada', 'Baz', 'Cleo', 'Dex', 'Etta'];

export function playerName(p: number, names: SeatNames = PLAYER_NAMES): string {
  return names[p] ?? `Player ${p + 1}`;
}

/** Short label printed on a card face. 13 is the Skip-Bo card. */
export function rankLabel(rank: number): string {
  return rank === 13 ? 'SB' : String(rank);
}

export function rankAriaLabel(rank: number): string {
  return rank === 13 ? 'Skip-Bo card' : `Card, rank ${rank}`;
}

/** "R1C3" — compact grid coordinate for a row-major index. */
export function spotLabel(i: number): string {
  return `R${rowOf(i) + 1}C${colOf(i) + 1}`;
}

/** "row 1, column 3" — spoken form, used for accessible names and the log. */
export function spotName(i: number): string {
  return `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;
}

export interface RunningScore {
  /** Score contributed by the columns and squares that are fully visible. */
  score: number;
  /** Columns still holding at least one face-down card. */
  hiddenColumns: number;
}

/**
 * The human's score as far as it can honestly be known.
 *
 * A player cannot see their own face-down cards, so a column containing one is
 * left out of the running total rather than peeked at. Square bonuses are only
 * counted when all four of their cards are visible.
 */
export function runningScore(ranks: readonly (number | null)[]): RunningScore {
  let score = 0;
  let hiddenColumns = 0;

  for (let col = 0; col < COLS; col++) {
    const top = ranks[col];
    const bottom = ranks[col + COLS];
    if (top == null || bottom == null) {
      hiddenColumns += 1;
      continue;
    }
    if (top === bottom && !SPECIAL_RANKS.has(top as Rank)) continue;
    if (!SPECIAL_RANKS.has(top as Rank)) score += top;
    if (!SPECIAL_RANKS.has(bottom as Rank)) score += bottom;
  }

  const used = new Array(COLS).fill(false);
  for (let col = 0; col < COLS - 1; col++) {
    if (used[col] || used[col + 1]) continue;
    const quad = [ranks[col], ranks[col + 1], ranks[col + COLS], ranks[col + 1 + COLS]];
    if (quad.some((r) => r == null)) continue;
    if (quad.every((r) => r === quad[0])) {
      score -= 10;
      used[col] = true;
      used[col + 1] = true;
    }
  }

  return { score, hiddenColumns };
}

/**
 * A public description of an action, written from `pre` (the state before it was
 * applied). Deliberately never mentions a rank that the action does not make
 * public: a card drawn face-down from the pile, or a card displaced into an
 * opponent's hand, stays unnamed unless the human is the one holding it.
 */
export function describeAction(
  pre: GameState,
  action: Action,
  names: SeatNames = PLAYER_NAMES,
): string {
  const player = pre.current;
  const who = playerName(player, names);
  const isHuman = player === HUMAN;
  const subject = isHuman ? 'You' : who;
  const verb = (base: string, thirdPerson: string) => (isHuman ? base : thirdPerson);

  switch (action.type) {
    case 'draw': {
      const src = action.source;
      if (src.kind === 'center') {
        const rank = pre.centerCard ? rankLabel(pre.centerCard.rank) : '?';
        return `${subject} ${verb('take', 'takes')} the centre card (${rank}).`;
      }
      if (src.kind === 'pile') {
        // The pile is face down, so the rank is private unless it is ours.
        return `${subject} ${verb('draw', 'draws')} from the draw pile.`;
      }
      const pile = pre.players[src.player].discard;
      const top = pile[pile.length - 1];
      const rank = top ? rankLabel(top.rank) : '?';
      return `${subject} ${verb('take', 'takes')} the ${rank} from ${playerName(src.player, names)}'s discard.`;
    }
    case 'place': {
      const rank = pre.held ? rankLabel(pre.held.rank) : '?';
      const where = spotName(action.spot);
      if (pre.placements === 0) {
        return `${subject} ${verb('place', 'places')} the ${rank} into ${where}.`;
      }
      return `${subject} ${verb('wave', 'waves')} the ${rank} into ${where}.`;
    }
    case 'discard': {
      const rank = pre.held ? rankLabel(pre.held.rank) : '?';
      return `${subject} ${verb('discard', 'discards')} the ${rank}. Turn over.`;
    }
  }
}

/** A short, human-readable rendering of a suggested action, for the hint panel. */
export function describeSuggestion(
  state: GameState,
  action: Action,
  names: SeatNames = PLAYER_NAMES,
): string {
  switch (action.type) {
    case 'draw': {
      const src = action.source;
      if (src.kind === 'center') {
        const rank = state.centerCard ? rankLabel(state.centerCard.rank) : '?';
        return `Take the centre card (${rank}).`;
      }
      if (src.kind === 'pile') return 'Draw from the face-down pile.';
      const pile = state.players[src.player].discard;
      const top = pile[pile.length - 1];
      return `Take the ${top ? rankLabel(top.rank) : '?'} from ${playerName(src.player, names)}'s discard.`;
    }
    case 'place': {
      const rank = state.held ? rankLabel(state.held.rank) : 'held card';
      const verb = state.placements === 0 ? 'Place' : 'Wave';
      return `${verb} the ${rank} into ${spotName(action.spot)} (${spotLabel(action.spot)}).`;
    }
    case 'discard': {
      const rank = state.held ? rankLabel(state.held.rank) : 'held card';
      return `Discard the ${rank} and end the turn.`;
    }
  }
}

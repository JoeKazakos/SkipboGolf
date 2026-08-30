import {
  COLS,
  DECK_SIZE,
  GRID_SIZE,
  SPECIAL_RANKS,
  oppositeOf,
  type Rank,
} from '../engine/cards';
import type { Rng } from '../engine/rng';
import { knownCards, legalActions } from '../engine/state';
import type { Action, GameState, Slot } from '../engine/types';
import type { Agent } from './agent';

/**
 * What one player can work out about a play area: a rank where the card is face
 * up, `null` where it is still face down. The AI is never handed a face-down
 * rank, so it cannot accidentally cheat.
 */
export type GridView = readonly (Rank | null)[];

/** 7, 11 and 13 score nothing, which is what makes them the cards worth keeping. */
export const cardValue = (rank: Rank): number => (SPECIAL_RANKS.has(rank) ? 0 : rank);

/**
 * Mean scoring value of a card drawn blind. The deck carries 12 copies each of
 * ranks 1-12 plus 18 Skip-Bos; counting 7, 11 and 13 as zero leaves 720 points
 * spread over 162 cards.
 */
const HIDDEN_EV = 720 / DECK_SIZE;

/** Rough chance an unseen card matches a named non-special rank: 11 of the other 161. */
const P_MATCH = 11 / (DECK_SIZE - 1);

const FULL_SQUARE = -10;
/** Three quarters of a square is worth chasing, so it is valued well above its raw odds. */
const THREE_QUARTER_SQUARE = -2.5;
const HALF_SQUARE = -0.6;

/** Per face-up card. Turning cards over races the round to an end and denies opponents turns. */
const FACE_UP_WEIGHT = 0.4;
/** Extra credit for actually being the player who triggers the final turn cycle. */
const ROUND_END_BONUS = 3;
/** Per opponent who could immediately wave the rank we are about to discard. */
const DISCARD_GIFT_PENALTY = 0.25;

/**
 * How much harder a race-aware agent pushes to turn cards face up when an
 * opponent is close to going out.
 */
const RACE_GAIN = 2.2;

/**
 * The value of turning a card face up, given how the race stands.
 *
 * The plain evaluation only ever sees your own grid, so it plays the same way
 * whether the round has fifty turns left or one. When an opponent is one card
 * from going out, a tidy hand you never get to finish is worth nothing, and
 * flipping cards matters far more than polishing columns. This scales the
 * face-up term by the closest opponent's progress.
 */
export function raceFaceUpWeight(s: GameState): number {
  let closest = 0;
  for (let p = 0; p < s.players.length; p++) {
    if (p === s.current) continue;
    let up = 0;
    for (const slot of s.players[p].grid) if (slot.faceUp) up += 1;
    if (up > closest) closest = up;
  }
  const pressure = closest / GRID_SIZE;
  return FACE_UP_WEIGHT * (1 + RACE_GAIN * pressure * pressure);
}

/** Number of copies of each rank in a full deck, indexed by rank (index 0 unused). */
export function deckRankCounts(): number[] {
  const counts = new Array<number>(14).fill(0);
  for (let rank = 1; rank <= 12; rank++) counts[rank] = 12;
  counts[13] = 18;
  return counts;
}

/** Masks the face-down cards out of a play area, giving what its owner may reason about. */
export function gridView(grid: readonly Slot[]): (Rank | null)[] {
  return grid.map((slot) => (slot.faceUp ? slot.card.rank : null));
}

/** Expected score of one column, averaging over any card still face down. */
function expectedColumnScore(top: Rank | null, bottom: Rank | null): number {
  if (top != null && bottom != null) {
    if (top === bottom && !SPECIAL_RANKS.has(top)) return 0;
    return cardValue(top) + cardValue(bottom);
  }
  if (top == null && bottom == null) {
    // Two unknowns cancel each other now and then, which is worth a small discount.
    return 2 * HIDDEN_EV * (1 - P_MATCH);
  }
  const known = (top ?? bottom) as Rank;
  // A special rank never cancels, so it gets no discount - but it also adds nothing.
  const cancelChance = SPECIAL_RANKS.has(known) ? 0 : P_MATCH;
  return (1 - cancelChance) * (cardValue(known) + HIDDEN_EV);
}

/** True when all four cells of the 2x2 square starting at `col` are known and identical. */
function isCompleteSquare(view: GridView, col: number): boolean {
  const a = view[col];
  return a != null && a === view[col + 1] && a === view[col + COLS] && a === view[col + 1 + COLS];
}

/**
 * How near the 2x2 square at `col` is to completion. Two different known ranks
 * anywhere in the square kill it outright.
 */
function partialSquareBonus(view: GridView, col: number): number {
  // Written out rather than looped over an array: this is the hottest line in
  // the whole AI, called millions of times inside search.
  let rank: Rank | null = null;
  let matching = 0;
  for (let k = 0; k < 4; k++) {
    const cell = view[k < 2 ? col + k : col + (k - 2) + COLS];
    if (cell == null) continue;
    if (rank == null) {
      rank = cell;
      matching = 1;
    } else if (cell === rank) {
      matching += 1;
    } else {
      return 0;
    }
  }
  if (matching === 3) return THREE_QUARTER_SQUARE;
  if (matching === 2) return HALF_SQUARE;
  return 0;
}

/**
 * Square bonuses, counted left to right with no column reused, exactly as
 * section 12 requires. `includePartial` adds shaping credit for squares that are
 * only part-built; the scoring rules know nothing of those.
 */
function squareTerm(view: GridView, includePartial: boolean): number {
  let total = 0;
  let used = 0;
  // Real squares are claimed first so shaping credit can never displace one.
  for (let col = 0; col < COLS - 1; col++) {
    if ((used & (1 << col)) !== 0 || (used & (1 << (col + 1))) !== 0) continue;
    if (!isCompleteSquare(view, col)) continue;
    total += FULL_SQUARE;
    used |= (1 << col) | (1 << (col + 1));
  }
  if (!includePartial) return total;
  for (let col = 0; col < COLS - 1; col++) {
    if ((used & (1 << col)) !== 0 || (used & (1 << (col + 1))) !== 0) continue;
    const bonus = partialSquareBonus(view, col);
    if (bonus === 0) continue;
    total += bonus;
    used |= (1 << col) | (1 << (col + 1));
  }
  return total;
}

/**
 * Best guess at the score this play area will finish on, averaging over cards
 * still face down. Carries no strategic shaping, so it is directly comparable
 * with `returns()` and is what a cut-short rollout falls back on.
 */
export function expectedScore(view: GridView): number {
  let score = 0;
  for (let col = 0; col < COLS; col++) score += expectedColumnScore(view[col], view[col + COLS]);
  return score + squareTerm(view, false);
}

/**
 * The evaluation the agents choose moves by: lower is better, on roughly the
 * same scale as a round score.
 *
 * On top of the expected score it credits part-built 2x2 squares and every card
 * turned face up. The face-up term is what makes an agent race for the round-end
 * trigger instead of endlessly polishing a hand nobody will get to see.
 */
export function evaluateGrid(view: GridView, faceUpWeight = FACE_UP_WEIGHT): number {
  let known = 0;
  for (const cell of view) if (cell != null) known += 1;

  let score = 0;
  for (let col = 0; col < COLS; col++) score += expectedColumnScore(view[col], view[col + COLS]);
  score += squareTerm(view, true);
  score -= faceUpWeight * known;
  if (known === GRID_SIZE) score -= ROUND_END_BONUS;
  return score;
}

/**
 * Evaluation of the grid that results from dropping `rank` into `spot`, without
 * allocating a copy. The scratch array is restored before returning.
 */
function valueAfterPlacing(view: (Rank | null)[], spot: number, rank: Rank): number {
  const previous = view[spot];
  view[spot] = rank;
  const value = evaluateGrid(view);
  view[spot] = previous;
  return value;
}

/** Small deterrent against handing an opponent a card they can wave straight away. */
function discardPenalty(s: GameState, rank: Rank): number {
  let exposed = 0;
  for (let p = 0; p < s.players.length; p++) {
    if (p === s.current) continue;
    if (s.players[p].grid.some((slot) => slot.faceUp && slot.card.rank === rank)) exposed += 1;
  }
  return DISCARD_GIFT_PENALTY * exposed;
}

/** Copies of each rank the viewer has not seen anywhere, indexed by rank. */
export function unseenRankCounts(s: GameState, viewer: number): number[] {
  const counts = deckRankCounts();
  for (const card of knownCards(s, viewer)) counts[card.rank] -= 1;
  return counts;
}

/** Node allowance for one turn search. A turn is at most 10 placements deep. */
const TURN_SEARCH_NODES = 600;

/**
 * Everything the within-turn search needs, in a form it can mutate and restore
 * rather than clone. Running the search over `GameState` would mean a full
 * ten-slot, six-player copy per node, which dominated the profile.
 */
interface TurnContext {
  /** The acting player's grid as they see it; `null` where a card is still face down. */
  view: (Rank | null)[];
  /** Spots already played into this turn (section 15.1). */
  locked: boolean[];
  /** Cost of ending the turn by discarding each rank, indexed by rank. */
  discardCost: number[];
  /** Cost of ending the turn discarding a card whose rank we do not know. */
  unknownDiscardCost: number;
  budget: { nodes: number };
  /** Value of a face-up card for this turn; raised when the race is tight. */
  faceUpWeight: number;
}

function makeTurnContext(s: GameState, nodes: number, raceAware: boolean): TurnContext {
  const discardCost = new Array<number>(14).fill(0);
  for (let rank = 1; rank <= 13; rank++) discardCost[rank] = discardPenalty(s, rank as Rank);

  // A card we have not seen costs the average over everything still unaccounted for.
  const counts = unseenRankCounts(s, s.current);
  let total = 0;
  let weight = 0;
  for (let rank = 1; rank <= 13; rank++) {
    if (counts[rank] <= 0) continue;
    total += counts[rank] * discardCost[rank];
    weight += counts[rank];
  }

  return {
    view: gridView(s.players[s.current].grid),
    locked: [...s.locked],
    discardCost,
    unknownDiscardCost: weight > 0 ? total / weight : 0,
    budget: { nodes },
    faceUpWeight: raceAware ? raceFaceUpWeight(s) : FACE_UP_WEIGHT,
  };
}

/**
 * Best cost reachable from holding `held`, exploring every wave chain the rules
 * allow. Lower is better.
 *
 * Crucially the search stops the moment it would turn over a card it cannot
 * see: the displaced card becomes the held card, and an agent that planned a
 * chain through a face-down slot would be reading cards it has no right to.
 * Judging what lies under those slots is ISMCTS's job, not the heuristic's.
 */
function bestTurnCost(ctx: TurnContext, held: Rank, placements: number): number {
  // Stopping now is always available (section 15.3), so it is the baseline.
  let best = evaluateGrid(ctx.view, ctx.faceUpWeight) + ctx.discardCost[held];
  if (ctx.budget.nodes <= 0) return best;

  for (let spot = 0; spot < GRID_SIZE; spot++) {
    if (ctx.locked[spot]) continue;
    if (placements > 0) {
      // Every placement after the first must be a legal wave (section 9).
      const opposite = ctx.view[oppositeOf(spot)];
      if (opposite == null || opposite !== held) continue;
    }
    ctx.budget.nodes -= 1;
    if (ctx.budget.nodes < 0) break;
    const value = costAfterPlacing(ctx, spot, held, placements);
    if (value < best) best = value;
  }
  return best;
}

/** Cost of playing `held` into `spot` and then finishing the turn as well as possible. */
function costAfterPlacing(
  ctx: TurnContext,
  spot: number,
  held: Rank,
  placements: number,
): number {
  const displaced = ctx.view[spot];
  ctx.view[spot] = held; // every placed card lands face up (section 15.4)
  ctx.locked[spot] = true;

  const value =
    displaced == null
      ? evaluateGrid(ctx.view, ctx.faceUpWeight) + ctx.unknownDiscardCost
      : bestTurnCost(ctx, displaced, placements + 1);

  ctx.view[spot] = displaced;
  ctx.locked[spot] = false;
  return value;
}

/**
 * Cost of each action under the full within-turn search, lower being better.
 *
 * The act phase is where nearly all of this evaluation's strength lives: a
 * placement is only worth making if the wave chain it starts pays off, and that
 * cannot be judged one ply at a time. `nodes` caps the search so the same code
 * can serve both the deliberate agent and a hurried rollout.
 */
export function turnSearchCosts(
  s: GameState,
  actions: readonly Action[],
  nodes = TURN_SEARCH_NODES,
  raceAware = false,
): number[] {
  const ctx = makeTurnContext(s, nodes, raceAware);

  if (s.phase !== 'draw') {
    const held = (s.held as { rank: Rank }).rank;
    const stand = evaluateGrid(ctx.view, ctx.faceUpWeight) + ctx.discardCost[held];
    return actions.map((action) => {
      if (action.type !== 'place') return stand;
      ctx.budget.nodes = nodes; // every candidate gets the same allowance
      return costAfterPlacing(ctx, action.spot, held, s.placements);
    });
  }

  const cache = new Map<number, number>();
  const valueOf = (rank: Rank): number => {
    const cached = cache.get(rank);
    if (cached !== undefined) return cached;
    ctx.budget.nodes = nodes;
    const value = bestTurnCost(ctx, rank, 0);
    cache.set(rank, value);
    return value;
  };

  let blind: number | null = null;
  return actions.map((action) => {
    if (action.type !== 'draw') return Number.POSITIVE_INFINITY;
    if (action.source.kind === 'center') return valueOf((s.centerCard as { rank: Rank }).rank);
    if (action.source.kind === 'discard') {
      const pile = s.players[action.source.player].discard;
      return valueOf(pile[pile.length - 1].rank);
    }
    if (blind == null) {
      // A blind draw is worth the average over every card still unaccounted for.
      const counts = unseenRankCounts(s, s.current);
      let total = 0;
      let weight = 0;
      for (let rank = 1; rank <= 13; rank++) {
        if (counts[rank] <= 0) continue;
        total += counts[rank] * valueOf(rank as Rank);
        weight += counts[rank];
      }
      blind = weight > 0 ? total / weight : Number.POSITIVE_INFINITY;
    }
    return blind;
  });
}

/** Turns costs into a [0, 1] preference, 1 for the best action available. */
function normalisePriors(costs: readonly number[]): number[] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const cost of costs) {
    if (!Number.isFinite(cost)) continue;
    if (cost < min) min = cost;
    if (cost > max) max = cost;
  }
  if (!Number.isFinite(min) || max - min < 1e-9) return costs.map(() => 0.5);
  return costs.map((cost) => (Number.isFinite(cost) ? (max - cost) / (max - min) : 0));
}

/** The full-strength preference over actions. ISMCTS uses it at the root. */
export function turnSearchPriors(
  s: GameState,
  actions: readonly Action[],
  raceAware = false,
): number[] {
  return normalisePriors(turnSearchCosts(s, actions, TURN_SEARCH_NODES, raceAware));
}

/** Picks the argmin of a cost vector, preferring the earlier action on a tie. */
function argmin(actions: readonly Action[], costs: readonly number[]): Action {
  let best = 0;
  for (let i = 1; i < costs.length; i++) if (costs[i] < costs[best]) best = i;
  return actions[best];
}

/**
 * The strongest move this evaluation can justify, searched over the remainder of
 * the current turn. Exported so ISMCTS and the arena can share it.
 */
export function heuristicAction(s: GameState, raceAware = false): Action {
  const actions = legalActions(s);
  if (actions.length === 0) throw new Error('no legal actions available');
  return argmin(actions, turnSearchCosts(s, actions, TURN_SEARCH_NODES, raceAware));
}

/** Greedy play under `evaluateGrid`, with no tree search. The arena's middle rung. */
export function createHeuristicAgent(name = 'heuristic', raceAware = false): Agent {
  return {
    name,
    async chooseAction(state) {
      return heuristicAction(state, raceAware);
    },
  };
}

/** Chance that the rollout policy plays a uniformly random legal action instead. */
const ROLLOUT_EPSILON = 0.1;

/** Draws a rank from the unseen multiset, for costing a blind draw cheaply. */
function sampleUnseenRank(counts: readonly number[], rng: Rng): Rank | null {
  let total = 0;
  for (let rank = 1; rank <= 13; rank++) total += Math.max(0, counts[rank]);
  if (total === 0) return null;
  let target = rng.next() * total;
  for (let rank = 1; rank <= 13; rank++) {
    target -= Math.max(0, counts[rank]);
    if (target <= 0) return rank as Rank;
  }
  return 13;
}

/** One-ply value of holding `rank`: the best single placement, or leaving the grid alone. */
function bestSinglePlacement(view: (Rank | null)[], rank: Rank): number {
  let best = evaluateGrid(view);
  for (let spot = 0; spot < GRID_SIZE; spot++) {
    const value = valueAfterPlacing(view, spot, rank);
    if (value < best) best = value;
  }
  return best;
}

/**
 * Node allowance for a rollout's turn search. Measured ablations showed the act
 * decision, not the draw, is where nearly all of the heuristic's strength lives,
 * so the rollout keeps a real - if short - wave search and economises on the
 * draw instead.
 */
const ROLLOUT_TURN_NODES = 60;

/**
 * One-ply cost of each action for the player to move, lower being better. Used
 * only as a search prior, so it is deliberately the cheap estimate rather than
 * the full turn search.
 */
function policyCosts(s: GameState, actions: readonly Action[]): number[] {
  const view = gridView(s.players[s.current].grid);

  if (s.phase !== 'draw') {
    const held = s.held as { rank: Rank };
    const stand = evaluateGrid(view) + discardPenalty(s, held.rank);
    return actions.map((action) =>
      action.type === 'place' ? valueAfterPlacing(view, action.spot, held.rank) : stand,
    );
  }

  const placementCost = new Map<number, number>();
  const costOf = (rank: Rank): number => {
    const cached = placementCost.get(rank);
    if (cached !== undefined) return cached;
    const value = bestSinglePlacement(view, rank);
    placementCost.set(rank, value);
    return value;
  };

  let blind: number | null = null;
  return actions.map((action) => {
    if (action.type !== 'draw') return Number.POSITIVE_INFINITY;
    if (action.source.kind === 'center') return costOf((s.centerCard as { rank: Rank }).rank);
    if (action.source.kind === 'discard') {
      const pile = s.players[action.source.player].discard;
      return costOf(pile[pile.length - 1].rank);
    }
    if (blind == null) {
      const counts = unseenRankCounts(s, s.current);
      let total = 0;
      let weight = 0;
      for (let rank = 1; rank <= 13; rank++) {
        if (counts[rank] <= 0) continue;
        total += counts[rank] * costOf(rank as Rank);
        weight += counts[rank];
      }
      blind = weight > 0 ? total / weight : Number.POSITIVE_INFINITY;
    }
    return blind;
  });
}

/**
 * How much this evaluation likes each action, normalised to [0, 1] with 1 for
 * the best available. ISMCTS uses it as a progressive bias so that a search cut
 * short by its budget still plays sensibly instead of near-randomly.
 */
export function policyPriors(s: GameState, actions: readonly Action[]): number[] {
  return normalisePriors(policyCosts(s, actions));
}

/**
 * The rollout policy: the same evaluation, a shallow turn search, and a little
 * noise. ISMCTS runs this many thousands of times, so the draw is costed from a
 * single sampled rank rather than the full distribution.
 */
export function rolloutAction(s: GameState, rng: Rng, raceAware = false): Action {
  const actions = legalActions(s);
  if (actions.length === 0) throw new Error('no legal actions available');
  if (rng.next() < ROLLOUT_EPSILON) return actions[Math.floor(rng.next() * actions.length)];

  if (s.phase !== 'draw') {
    return argmin(actions, turnSearchCosts(s, actions, ROLLOUT_TURN_NODES, raceAware));
  }

  const view = gridView(s.players[s.current].grid);
  let best = actions[0];
  let bestValue = Number.POSITIVE_INFINITY;
  for (const action of actions) {
    if (action.type !== 'draw') continue;
    let rank: Rank | null;
    if (action.source.kind === 'center') {
      rank = (s.centerCard as { rank: Rank }).rank;
    } else if (action.source.kind === 'discard') {
      const pile = s.players[action.source.player].discard;
      rank = pile[pile.length - 1].rank;
    } else {
      // One sample stands in for the whole distribution; rollouts are noisy anyway.
      rank = sampleUnseenRank(unseenRankCounts(s, s.current), rng);
    }
    const value = rank == null ? Number.POSITIVE_INFINITY : bestSinglePlacement(view, rank);
    if (value < bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}

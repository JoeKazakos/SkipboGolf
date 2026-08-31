import { legalActions } from '../engine/state';
import { makeRng } from '../engine/rng';
import type { Action, GameState } from '../engine/types';
import { createRandomAgent, type Agent } from './agent';
import { createHeuristicAgent } from './heuristic';
import { createIsmctsAgent } from './ismcts';

/**
 * Wraps an agent so it plays a uniformly random legal action `epsilon` of the
 * time.
 *
 * This exists only to fill the very wide gap between random play (around 970
 * Elo) and the bare heuristic (around 1585). Without it the roster would jump
 * straight from "makes no sense at all" to "competent", with nothing in
 * between for a new player to practise against. It is deliberately NOT used
 * above the heuristic tier: a strong search that occasionally throws the game
 * away feels broken rather than beatable.
 */
export function createBlunderingAgent(base: Agent, epsilon: number, seed = 4242): Agent {
  const rng = makeRng(seed);
  return {
    name: `${base.name}-e${Math.round(epsilon * 100)}`,
    async chooseAction(state: GameState, player: number, opts): Promise<Action> {
      if (rng.next() < epsilon) {
        const actions = legalActions(state);
        if (actions.length === 0) throw new Error('no legal actions available');
        return actions[Math.floor(rng.next() * actions.length)];
      }
      return base.chooseAction(state, player, opts);
    },
  };
}

/** How an opponent decides, independent of what it is called on screen. */
export type OpponentKind =
  | 'random'
  | 'blundering-heuristic'
  | 'heuristic'
  | 'ismcts'
  | 'net';

export interface OpponentProfile {
  /** Stable id, used in saved settings and as a React key. */
  readonly id: string;
  /** Display name shown in the seat. */
  readonly name: string;
  /** One line on how this opponent plays, shown under the name. */
  readonly blurb: string;
  readonly kind: OpponentKind;
  /**
   * Measured Elo from the self-play ladder, and its standard error.
   * `null` until a ladder has been run for that tier - never guess a number
   * here, because the whole point of showing it is that it means something.
   */
  readonly elo: number | null;
  readonly eloError: number | null;
  /**
   * Coarse strength shown to the player, 1 (weakest) to 5 (strongest).
   *
   * Deliberately coarser than the Elo, because tiers that the measurement
   * cannot separate should not look separate: Vin and Nel share a band, and so
   * do Ada and Rook. Showing seven distinct steps would imply a precision the
   * ladder does not support.
   */
  readonly strength: 1 | 2 | 3 | 4 | 5;
  /** One-word label for that strength, for players who prefer words to pips. */
  readonly tier: string;
  /** Mean round score from the ladder; lower is better. */
  readonly meanScore: number | null;
  /** Share of ladder games won. */
  readonly winRate: number | null;
  /** Per-decision search budget, for the ISMCTS tiers only. */
  readonly budgetMs?: number;
  /** Blunder probability, for the blundering tier only. */
  readonly epsilon?: number;
  /**
   * Trained weights for the 'net' tier, served as a static file.
   *
   * A URL rather than a bundled module: at 64k parameters the weights are
   * about 250KB, and inlining them would make everyone download a network
   * whether or not they ever seat one.
   */
  readonly weightsUrl?: string;
  /**
   * Simulations per decision.
   *
   * Preferred over `budgetMs` where it is set, because it makes a tier's
   * strength a property of the tier rather than of the machine it runs on -
   * "40ms" is a different opponent on a phone than on a workstation, and its
   * measured Elo is then a fact about the box that measured it.
   */
  readonly iterations?: number;
  /**
   * Scale the value of turning cards face up by how close an opponent is to
   * going out. Off for the measured tiers, so their ratings still stand.
   */
  readonly raceAware?: boolean;
}

/**
 * The opponents you can seat, weakest first by measured rating.
 *
 * Measured 2026-08-30 by `node scripts/arena-parallel.mjs --games 480 --roster`
 * (480 games, ~411 per agent, 16 minutes across 18 processes), re-run after
 * priors were cached at node expansion. Re-run it after changing any tier.
 *
 * That change made the four ISMCTS tiers cheaper per iteration, and the ladder
 * moved the way that predicts: Vin +34, Rook +29, Ada +23, Sage -8, against
 * error bars near 33. Nel, Dot and Pip run untouched code, so their apparent
 * -6, -21 and -51 are the other side of the same relative shift, not a
 * regression in them. Mean scores agree - Sage 1.85 to 1.29, Ada 4.47 to 4.13,
 * Vin 7.09 to 6.59. Read this as no regression and a possible small gain for
 * the searching tiers; at roughly one standard error it is not more than that.
 *
 * The tiers use genuinely different methods rather than one engine throttled
 * down, so a weak opponent plays *simply* instead of erratically: it misses
 * good plays rather than making bizarre ones.
 *
 * Two things to know before editing:
 *
 * 1. Vin and Nel are not separable, and the order between them is arbitrary.
 *    A 480-game run put Nel ahead by 14 Elo with mean scores agreeing at about
 *    1.8 standard errors; a later 560-game run reversed BOTH, putting Vin
 *    ahead by 37. Each result sat inside its error bars, and reading the first
 *    as a real ordering was over-fitting to noise. They share a strength band
 *    because they genuinely cannot be told apart; do not reorder them on one
 *    run's evidence.
 *
 * 2. Search shows sharply diminishing returns at the top. Ada at 150ms to Sage
 *    at 2000ms, a thirteenfold increase, buys about 100 Elo, and Ada, Rook and
 *    Sage stay within a standard error or two of each other.
 */
export const ROSTER: readonly OpponentProfile[] = [
  {
    id: 'pip',
    name: 'Pip',
    blurb: 'Plays at random. Knows the rules and nothing else.',
    kind: 'random',
    strength: 1,
    tier: 'Beginner',
    meanScore: 43.41,
    winRate: 0.0,
    elo: 920,
    eloError: 25,
  },
  {
    id: 'dot',
    name: 'Dot',
    blurb: 'Has the right instincts but is easily distracted.',
    kind: 'blundering-heuristic',
    epsilon: 0.4,
    strength: 2,
    tier: 'Casual',
    meanScore: 20.65,
    winRate: 0.022,
    elo: 1313,
    eloError: 35,
  },
  {
    id: 'vin',
    name: 'Vin',
    blurb: 'Looks a little way ahead, though not far enough to show for it.',
    kind: 'ismcts',
    budgetMs: 40,
    strength: 3,
    tier: 'Steady',
    meanScore: 6.59,
    winRate: 0.153,
    elo: 1605,
    eloError: 33,
  },
  {
    id: 'nel',
    name: 'Nel',
    blurb: 'Always takes the best move she can see, but never looks ahead.',
    kind: 'heuristic',
    strength: 3,
    tier: 'Steady',
    meanScore: 7.31,
    winRate: 0.128,
    elo: 1579,
    eloError: 34,
  },
  {
    id: 'ada',
    name: 'Ada',
    blurb: 'Searches properly. A serious opponent.',
    kind: 'ismcts',
    budgetMs: 150,
    strength: 4,
    tier: 'Strong',
    meanScore: 4.13,
    winRate: 0.231,
    elo: 1650,
    eloError: 34,
  },
  {
    id: 'rook',
    name: 'Rook',
    blurb: 'Takes her time and rarely wastes a turn.',
    kind: 'ismcts',
    budgetMs: 600,
    strength: 4,
    tier: 'Strong',
    meanScore: 2.38,
    winRate: 0.291,
    elo: 1708,
    eloError: 32,
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Thinks hard about every card. Expect to lose.',
    kind: 'ismcts',
    budgetMs: 2000,
    strength: 5,
    tier: 'Expert',
    meanScore: 1.29,
    winRate: 0.34,
    elo: 1725,
    eloError: 36,
  },
];

export const DEFAULT_PROFILE_ID = 'ada';

export function profileById(id: string): OpponentProfile {
  const found = ROSTER.find((p) => p.id === id);
  if (!found) throw new Error(`unknown opponent profile: ${id}`);
  return found;
}

/**
 * Builds the agent for a profile.
 *
 * `seed` is mixed in so two seats running the same profile do not play
 * identical games, which would make a table of five clones obvious.
 */
export function createAgentForProfile(profile: OpponentProfile, seed = 1): Agent {
  const built = buildAgent(profile, seed);
  // Report the profile's display name, so arena results key straight back to
  // the roster instead of leaking implementation names like "heuristic-e40".
  return built.name === profile.name ? built : { ...built, name: profile.name };
}

function buildAgent(profile: OpponentProfile, seed: number): Agent {
  switch (profile.kind) {
    case 'random':
      return createRandomAgent(seed);
    case 'heuristic':
      return createHeuristicAgent(profile.name);
    case 'blundering-heuristic':
      return createBlunderingAgent(
        createHeuristicAgent(profile.name),
        profile.epsilon ?? 0.4,
        seed,
      );
    case 'ismcts':
    case 'net':
      // The 'net' tier needs an evaluator, which only the browser worker and
      // the node arena know how to load. Built here without one it is an
      // ordinary ISMCTS agent; see createOpponentAgent in ui/agents.ts and
      // net-arena.ts for the two paths that supply the weights.
      return createIsmctsAgent({
        name: profile.name,
        seed,
        budgetMs: profile.budgetMs ?? 150,
        ...(profile.iterations ? { maxIterations: profile.iterations } : {}),
        raceAware: profile.raceAware ?? false,
      });
  }
}

/** Preset tables, for filling all five seats in one click. */
export interface Preset {
  readonly id: string;
  readonly name: string;
  /**
   * Takes the opponent count, because a fixed string goes stale: "Five of the
   * best" was still on screen after the table was cut to three.
   */
  readonly description: (opponents: number) => string;
  /**
   * Profile ids in seating order, longest table first. A table with fewer
   * opponents takes the first N, so a preset keeps its character at any size.
   */
  readonly seats: readonly string[];
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'gentle',
    name: 'Gentle',
    description: () => 'A friendly table for learning the rules.',
    seats: ['pip', 'pip', 'dot', 'dot', 'nel', 'nel'],
  },
  {
    id: 'club',
    name: 'Club night',
    description: () => 'A mixed table, the way a real game goes.',
    seats: ['dot', 'nel', 'nel', 'vin', 'ada', 'vin'],
  },
  {
    id: 'tough',
    name: 'Tough crowd',
    description: () => 'Everyone here can play.',
    seats: ['nel', 'vin', 'ada', 'ada', 'rook', 'rook'],
  },
  {
    id: 'gauntlet',
    name: 'The gauntlet',
    description: (n) => `The ${n === 1 ? 'best there is' : `${n} best`}. Good luck.`,
    seats: ['ada', 'rook', 'rook', 'sage', 'sage', 'sage'],
  },
];

// The gauntlet by default: most people coming to this already play the game
// well, and a table that is too easy is a duller first impression than one
// that is too hard.
export const DEFAULT_PRESET_ID = 'gauntlet';

/** Opponent counts the table supports, alongside the one human player. */
export const MIN_OPPONENTS = 1;
export const MAX_OPPONENTS = 6;
export const DEFAULT_OPPONENTS = 5;

/** The first `count` seats of a preset, which is how a preset scales. */
export function presetSeats(id: string, count: number): string[] {
  const preset = presetById(id);
  const clamped = Math.max(MIN_OPPONENTS, Math.min(MAX_OPPONENTS, count));
  const seats = preset.seats.slice(0, clamped);
  // Every preset lists MAX_OPPONENTS, but guard rather than return a short
  // table if one is ever edited down.
  while (seats.length < clamped) seats.push(seats[seats.length - 1] ?? DEFAULT_PROFILE_ID);
  return seats;
}

export function presetById(id: string): Preset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown preset: ${id}`);
  return found;
}

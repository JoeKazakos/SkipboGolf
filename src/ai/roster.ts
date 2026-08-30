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
export type OpponentKind = 'random' | 'blundering-heuristic' | 'heuristic' | 'ismcts';

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
   * Scale the value of turning cards face up by how close an opponent is to
   * going out. Off for the measured tiers, so their ratings still stand.
   */
  readonly raceAware?: boolean;
}

/**
 * The opponents you can seat, weakest first by measured rating.
 *
 * Measured 2026-08-30 by `node scripts/arena-parallel.mjs --games 480 --roster`
 * (480 games, ~411 per agent, 18 minutes across 18 processes). Re-run it after
 * changing any tier.
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
    meanScore: 41.48,
    winRate: 0.006,
    elo: 971,
    eloError: 36,
  },
  {
    id: 'dot',
    name: 'Dot',
    blurb: 'Has the right instincts but is easily distracted.',
    kind: 'blundering-heuristic',
    epsilon: 0.4,
    strength: 2,
    tier: 'Casual',
    meanScore: 20.08,
    winRate: 0.014,
    elo: 1334,
    eloError: 33,
  },
  {
    id: 'vin',
    name: 'Vin',
    blurb: 'Looks a little way ahead, though not far enough to show for it.',
    kind: 'ismcts',
    budgetMs: 40,
    strength: 3,
    tier: 'Steady',
    meanScore: 7.09,
    winRate: 0.15,
    elo: 1571,
    eloError: 34,
  },
  {
    id: 'nel',
    name: 'Nel',
    blurb: 'Always takes the best move she can see, but never looks ahead.',
    kind: 'heuristic',
    strength: 3,
    tier: 'Steady',
    meanScore: 5.71,
    winRate: 0.221,
    elo: 1585,
    eloError: 35,
  },
  {
    id: 'ada',
    name: 'Ada',
    blurb: 'Searches properly. A serious opponent.',
    kind: 'ismcts',
    budgetMs: 150,
    strength: 4,
    tier: 'Strong',
    meanScore: 4.47,
    winRate: 0.199,
    elo: 1627,
    eloError: 28,
  },
  {
    id: 'rook',
    name: 'Rook',
    blurb: 'Takes her time and rarely wastes a turn.',
    kind: 'ismcts',
    budgetMs: 600,
    strength: 4,
    tier: 'Strong',
    meanScore: 2.36,
    winRate: 0.265,
    elo: 1679,
    eloError: 30,
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Thinks hard about every card. Expect to lose.',
    kind: 'ismcts',
    budgetMs: 2000,
    strength: 5,
    tier: 'Expert',
    meanScore: 1.85,
    winRate: 0.31,
    elo: 1733,
    eloError: 26,
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
      return createIsmctsAgent({
        name: profile.name,
        seed,
        budgetMs: profile.budgetMs ?? 150,
        raceAware: profile.raceAware ?? false,
      });
  }
}

/** Preset tables, for filling all five seats in one click. */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
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
    description: 'A friendly table for learning the rules.',
    seats: ['pip', 'pip', 'dot', 'dot', 'nel', 'nel'],
  },
  {
    id: 'club',
    name: 'Club night',
    description: 'A mixed table, the way a real game goes.',
    seats: ['dot', 'nel', 'nel', 'vin', 'ada', 'vin'],
  },
  {
    id: 'tough',
    name: 'Tough crowd',
    description: 'Everyone here can play.',
    seats: ['nel', 'vin', 'ada', 'ada', 'rook', 'rook'],
  },
  {
    id: 'gauntlet',
    name: 'The gauntlet',
    description: 'Five of the best. Good luck.',
    seats: ['ada', 'rook', 'rook', 'sage', 'sage', 'sage'],
  },
];

export const DEFAULT_PRESET_ID = 'club';

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

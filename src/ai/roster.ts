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
 * This exists only to fill the very wide gap between random play (around 980
 * Elo) and the bare heuristic (around 1700). Without it the roster would jump
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
   * Deliberately coarser than the Elo, because the measurement says the four
   * searching tiers are barely separable: Vin and Ada share a band, and so do
   * Rook and Sage. Showing five distinct steps here would imply a precision
   * the ladder does not support.
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
}

/**
 * The opponents you can seat, weakest first.
 *
 * Ratings measured 2026-08-29 by `ARENA_ROSTER=1 ARENA_GAMES=120 npm run arena`
 * (120 games, ~103 per agent, 73 minutes). Re-run it after changing any tier.
 *
 * Read the error bars before trusting a gap. The ladder is monotonic in all
 * three measures - Elo, mean score and win rate - but the four searching tiers
 * sit within about 90 Elo of each other with error bars of roughly 30, so
 * Rook and Ada in particular are NOT statistically distinguishable. Extra
 * search budget shows sharply diminishing returns: 40ms to 2000ms, a fiftyfold
 * increase, buys under 90 Elo. The gaps that are unambiguous are the ones
 * below Nel.
 *
 * The tiers use genuinely different methods rather than one engine throttled
 * down, so a weak opponent plays *simply* instead of erratically: it misses
 * good plays rather than making bizarre ones.
 */
export const ROSTER: readonly OpponentProfile[] = [
  {
    id: 'pip',
    name: 'Pip',
    blurb: 'Plays at random. Knows the rules and nothing else.',
    kind: 'random',
    strength: 1,
    tier: 'Beginner',
    meanScore: 41.03,
    winRate: 0.0,
    elo: 971,
    eloError: 48,
  },
  {
    id: 'dot',
    name: 'Dot',
    blurb: 'Has the right instincts but is easily distracted.',
    kind: 'blundering-heuristic',
    strength: 2,
    tier: 'Casual',
    meanScore: 22.43,
    winRate: 0.019,
    epsilon: 0.4,
    elo: 1274,
    eloError: 38,
  },
  {
    id: 'nel',
    name: 'Nel',
    blurb: 'Always takes the best move she can see, but never looks ahead.',
    kind: 'heuristic',
    strength: 3,
    tier: 'Steady',
    meanScore: 8.62,
    winRate: 0.138,
    elo: 1552,
    eloError: 43,
  },
  {
    id: 'vin',
    name: 'Vin',
    blurb: 'Thinks ahead a little, and counts the cards already shown.',
    kind: 'ismcts',
    strength: 4,
    tier: 'Strong',
    meanScore: 4.41,
    winRate: 0.183,
    budgetMs: 40,
    elo: 1640,
    eloError: 29,
  },
  {
    id: 'ada',
    name: 'Ada',
    blurb: 'Searches properly. A serious opponent.',
    kind: 'ismcts',
    strength: 4,
    tier: 'Strong',
    meanScore: 3.17,
    winRate: 0.207,
    budgetMs: 150,
    elo: 1665,
    eloError: 26,
  },
  {
    id: 'rook',
    name: 'Rook',
    blurb: 'Takes her time and rarely wastes a turn.',
    kind: 'ismcts',
    strength: 5,
    tier: 'Expert',
    meanScore: 2.06,
    winRate: 0.252,
    budgetMs: 600,
    elo: 1669,
    eloError: 30,
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Thinks hard about every card. Expect to lose.',
    kind: 'ismcts',
    strength: 5,
    tier: 'Expert',
    meanScore: 1.24,
    winRate: 0.369,
    budgetMs: 2000,
    elo: 1729,
    eloError: 29,
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

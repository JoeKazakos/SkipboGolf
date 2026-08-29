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
    elo: 971,
    eloError: 48,
  },
  {
    id: 'dot',
    name: 'Dot',
    blurb: 'Has the right instincts but is easily distracted.',
    kind: 'blundering-heuristic',
    epsilon: 0.4,
    elo: 1274,
    eloError: 38,
  },
  {
    id: 'nel',
    name: 'Nel',
    blurb: 'Always takes the best move she can see, but never looks ahead.',
    kind: 'heuristic',
    elo: 1552,
    eloError: 43,
  },
  {
    id: 'vin',
    name: 'Vin',
    blurb: 'Thinks ahead a little, and counts the cards already shown.',
    kind: 'ismcts',
    budgetMs: 40,
    elo: 1640,
    eloError: 29,
  },
  {
    id: 'ada',
    name: 'Ada',
    blurb: 'Searches properly. A serious opponent.',
    kind: 'ismcts',
    budgetMs: 150,
    elo: 1665,
    eloError: 26,
  },
  {
    id: 'rook',
    name: 'Rook',
    blurb: 'Takes her time and rarely wastes a turn.',
    kind: 'ismcts',
    budgetMs: 600,
    elo: 1669,
    eloError: 30,
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Thinks hard about every card. Expect to lose.',
    kind: 'ismcts',
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
  /** Five profile ids, one per opponent seat. */
  readonly seats: readonly [string, string, string, string, string];
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'gentle',
    name: 'Gentle',
    description: 'A friendly table for learning the rules.',
    seats: ['pip', 'pip', 'dot', 'dot', 'nel'],
  },
  {
    id: 'club',
    name: 'Club night',
    description: 'A mixed table, the way a real game goes.',
    seats: ['dot', 'nel', 'nel', 'vin', 'ada'],
  },
  {
    id: 'tough',
    name: 'Tough crowd',
    description: 'Everyone here can play.',
    seats: ['nel', 'vin', 'ada', 'ada', 'rook'],
  },
  {
    id: 'gauntlet',
    name: 'The gauntlet',
    description: 'Five of the best. Good luck.',
    seats: ['ada', 'rook', 'rook', 'sage', 'sage'],
  },
];

export const DEFAULT_PRESET_ID = 'club';

export function presetById(id: string): Preset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown preset: ${id}`);
  return found;
}

import { legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import { makeRng } from '../engine/rng';

/**
 * The contract between the UI and any decision-making agent.
 *
 * An agent chooses ONE atomic action at a time (draw / place / discard), not a
 * whole turn. The caller loops, applying each action, until the turn ends.
 */
export interface Agent {
  readonly name: string;
  /**
   * Picks a legal action for `player` in `state`.
   * Implementations must return an action drawn from `legalActions(state)`.
   */
  chooseAction(
    state: GameState,
    player: number,
    opts?: { budgetMs?: number; signal?: AbortSignal },
  ): Promise<Action>;
}

/** Uniformly random legal play. The floor of the Elo ladder, and a UI stand-in. */
export function createRandomAgent(seed = 1): Agent {
  const rng = makeRng(seed);
  return {
    name: 'random',
    async chooseAction(state) {
      const actions = legalActions(state);
      if (actions.length === 0) throw new Error('no legal actions available');
      return actions[Math.floor(rng.next() * actions.length)];
    },
  };
}

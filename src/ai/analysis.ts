import { legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import { actionKey, ismctsSearch } from './ismcts';

/**
 * Analysing a position: the engine's recommended move, and why.
 *
 * The "why" is not generated prose. ismctsSearch already reports how many
 * times it visited each root action and how those visits turned out, so the
 * explanation is the search's real working. That is honest about what was
 * computed, and it costs nothing extra.
 */

export interface Candidate {
  action: Action;
  visits: number;
  /** Share of the search's visits, 0 to 1. */
  share: number;
  /** Mean outcome for this move, on the search's internal reward scale. */
  mean: number;
  /** True for the move the search settled on. */
  best: boolean;
}

export interface Analysis {
  candidates: Candidate[];
  iterations: number;
  /** True when only one move was legal, so no search was needed. */
  forced: boolean;
}

/**
 * Rebuilds an Action from the key the search reports it under.
 *
 * Uses the search's own actionKey rather than a second copy of the format: a
 * duplicate would drift and then silently match nothing, leaving an analysis
 * with no candidates and no error.
 */
function actionForKey(state: GameState, key: string): Action | null {
  for (const a of legalActions(state)) {
    if (actionKey(a) === key) return a;
  }
  return null;
}

export function analysePosition(
  state: GameState,
  player: number,
  options: { budgetMs?: number; maxIterations?: number; seed?: number } = {},
): Analysis {
  const legal = legalActions(state);
  if (legal.length === 0) return { candidates: [], iterations: 0, forced: false };
  if (legal.length === 1) {
    return {
      candidates: [{ action: legal[0], visits: 0, share: 1, mean: 0, best: true }],
      iterations: 0,
      forced: true,
    };
  }

  const result = ismctsSearch(state, player, {
    budgetMs: options.budgetMs ?? 2000,
    maxIterations: options.maxIterations,
    seed: options.seed,
  });

  const total = result.rootVisits.reduce((n, v) => n + v.visits, 0) || 1;
  const bestKey = actionKey(result.action);

  const candidates: Candidate[] = [];
  for (const v of result.rootVisits) {
    const action = actionForKey(state, v.key);
    if (!action) continue;
    candidates.push({
      action,
      visits: v.visits,
      share: v.visits / total,
      mean: v.mean,
      best: v.key === bestKey,
    });
  }
  candidates.sort((a, b) => b.visits - a.visits);

  return { candidates, iterations: result.iterations, forced: false };
}

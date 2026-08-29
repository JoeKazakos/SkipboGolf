import type { Agent } from '../ai/agent';
import { createWorkerAgent } from '../ai/worker';

/**
 * Per-decision search budget for the computer players.
 *
 * A turn is several decisions (draw, then one placement per wave in the chain,
 * then the discard), so the per-turn cost is roughly three to four times this.
 * 150ms therefore lands a normal turn near 500ms, which is the deliberate
 * starting point: fast enough to keep a six-player round brisk, and already
 * strong. Raise it if the opponents feel weak - measured self-play at 100ms
 * per decision already puts ISMCTS about 170 Elo above the heuristic, and the
 * search keeps improving with more time. The search runs in a Web Worker, so
 * the main thread stays responsive however high this goes.
 */
const OPPONENT_BUDGET_MS = 150;

/** The hint is a single on-demand decision, so it can afford to think longer. */
const HINT_BUDGET_MS = 1500;

/**
 * The single place the UI decides which agent drives the computer players.
 */
export function createOpponentAgent(seed = 20250828): Agent {
  return createWorkerAgent({ name: 'ismcts', seed, budgetMs: OPPONENT_BUDGET_MS });
}

/**
 * The agent consulted by the HINT button on the human's behalf. Kept separate
 * from the opponents so the two can diverge (it searches longer), and given its
 * own worker so asking for a hint never contends with an opponent's turn.
 */
export function createHintAgent(seed = 7): Agent {
  return createWorkerAgent({ name: 'hint', seed, budgetMs: HINT_BUDGET_MS });
}

import type { Agent } from '../ai/agent';
import { createAgentForProfile, profileById, type OpponentProfile } from '../ai/roster';
import { createWorkerAgent } from '../ai/worker';

/**
 * The hint is a single on-demand decision, so it can afford to think longer
 * than any opponent does.
 */
const HINT_BUDGET_MS = 1500;

/**
 * Builds the agent for one seated opponent.
 *
 * The searching profiles run in a Web Worker so the main thread stays
 * responsive while they think; the cheap profiles (random, heuristic) return
 * fast enough to run inline, and spawning a worker each would be wasteful.
 */
export function createOpponentAgent(profile: OpponentProfile, seed = 20250828): Agent {
  if (profile.kind !== 'ismcts' && profile.kind !== 'net') {
    return createAgentForProfile(profile, seed);
  }
  const worker = createWorkerAgent({
    name: profile.name,
    seed,
    budgetMs: profile.budgetMs ?? 150,
    ...(profile.iterations ? { maxIterations: profile.iterations } : {}),
    ...(profile.weightsUrl ? { weightsUrl: profile.weightsUrl } : {}),
    raceAware: profile.raceAware ?? false,
  });
  return worker.name === profile.name ? worker : { ...worker, name: profile.name };
}

/**
 * The agent consulted by the HINT button on the human's behalf. Deliberately
 * independent of who is seated: the quality of your advice should not depend
 * on how weak an opponent you chose to play against.
 */
export function createHintAgent(seed = 7): Agent {
  return createWorkerAgent({ name: 'hint', seed, budgetMs: HINT_BUDGET_MS });
}

/** The advisor behind the hint button, exposed for tests and tooling. */
export const HINT_PROFILE = () => profileById('ada');

import { createRandomAgent, type Agent } from '../ai/agent';

/**
 * The single place the UI decides which agent drives the computer players.
 *
 * The real ISMCTS agent is being built separately; when it lands, swapping it in
 * is a one-line change to this function's body and nothing else in the UI moves.
 */
export function createOpponentAgent(seed = 20250828): Agent {
  return createRandomAgent(seed);
}

/**
 * The agent consulted by the HINT button on the human's behalf. Kept separate
 * from the opponents so the two can diverge later (a stronger, slower advisor)
 * without touching any component.
 */
export function createHintAgent(seed = 7): Agent {
  return createRandomAgent(seed);
}

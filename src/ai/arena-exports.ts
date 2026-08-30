/**
 * The pieces a shard needs, separated so importing them never starts a run.
 *
 * arena.ts kicks off main() when --arena is on the command line, which a shard
 * must not trigger.
 */
export { NUM_PLAYERS } from '../engine/state';
export { playIndexedGame, summarise, formatTable, type GameResult } from './arena';
import { createRandomAgent, type Agent } from './agent';
import { createHeuristicAgent } from './heuristic';
import { createIsmctsAgent } from './ismcts';
import { ROSTER, createAgentForProfile } from './roster';
import { NUM_PLAYERS } from '../engine/state';

/** The three-tier ladder used for calibration runs. */
export function defaultLadder(budgetMs: number): Agent[] {
  const ismcts = createIsmctsAgent({ name: 'ismcts', budgetMs, seed: 7 });
  const heuristic = createHeuristicAgent();
  const random = createRandomAgent(99);
  return [ismcts, heuristic, random, ismcts, heuristic, random].slice(0, NUM_PLAYERS);
}

/** The playable roster, each profile at its own configured budget. */
export function rosterLadder(): Agent[] {
  return ROSTER.map((profile, i) => createAgentForProfile(profile, 1000 + i * 17));
}

/**
 * Does a longer rollout beat more iterations?
 *
 * A round lasts fifty to a hundred turns and the rollout stops after eight, so
 * roughly six rollouts in seven never see the end of the round and fall back
 * to a static evaluation that models no further play. That trade - fewer,
 * better-informed iterations against more, shallower ones - is what this
 * measures, at a fixed time budget so the comparison is fair.
 */
import { createIsmctsAgent } from './ismcts';
import { runArena, formatTable } from './arena';

declare const process: { argv?: string[]; env?: Record<string, string | undefined> } | undefined;

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const games = Number(env.ARENA_GAMES ?? 120);
  const budgetMs = Number(env.ARENA_BUDGET_MS ?? 150);
  const limits = (env.LIMITS ?? '8,24,60').split(',').map(Number);

  // Two seats each, so every game compares them directly.
  const ladder = [];
  for (const limit of limits) {
    ladder.push(
      createIsmctsAgent({ name: `t${limit}`, budgetMs, seed: 21, rolloutTurnLimit: limit }),
    );
  }
  for (const limit of limits) {
    ladder.push(
      createIsmctsAgent({ name: `t${limit}`, budgetMs, seed: 88, rolloutTurnLimit: limit }),
    );
  }

  console.log(`rollout turn limits ${limits.join(', ')} at ${budgetMs}ms, ${games} games`);
  const seed = Number(env.ARENA_SEED ?? 31337);
  const report = await runArena(ladder, { games, seed, seatCount: ladder.length });
  console.log(formatTable(report));
}

const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--horizon')) void main();

/**
 * One shard of the belief arena: does weighting the deal by an inference model
 * beat sampling the unseen cards uniformly?
 *
 * This is the first experiment in the milestone aimed at the constraint the
 * perfect-information probe actually found. That probe put 310 Elo at 7.6
 * standard errors between an agent that SEES the hidden cards and the identical
 * search that samples them, and every attempt so far went after the leaf value
 * instead, which the probe never implicated.
 *
 * Both rows run the identical search at the identical simulation count. The
 * only difference is how `determinize` deals the cards nobody has seen.
 */
import type { Agent } from '../agent';
import { playIndexedGame } from '../arena';
import { createIsmctsAgent } from '../ismcts';
import { createAgentForProfile, profileById } from '../roster';
import { loadBeliefProvider } from './beliefs';

declare const process:
  | { env?: Record<string, string | undefined>; stdout?: { write: (s: string) => void } }
  | undefined;

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const from = Number(env.BA_FROM ?? 0);
  const to = Number(env.BA_TO ?? 0);
  const iterations = Number(env.BA_ITERATIONS ?? 400);
  const seed = Number(env.BA_SEED ?? 909090);
  const seats = Number(env.BA_SEATS ?? 3);
  const weights = env.BA_WEIGHTS ?? 'training/inference/hidden-hand.bin';

  const common = { maxIterations: iterations, budgetMs: 3_600_000, seed: 4242 } as const;
  const temps = (env.BA_TEMPS ?? '1').split(',').map(Number);

  // Temperature 0 IS the uniform deal, so it doubles as the control and the
  // sweep's own zero point rather than being a separately-configured agent.
  const ladder: Agent[] = [createIsmctsAgent({ ...common, name: 'Uniform' })];
  for (const t of temps) {
    if (t <= 0) continue;
    ladder.push(
      createIsmctsAgent({
        ...common,
        name: `T${Math.round(t * 100)}`,
        beliefProvider: await loadBeliefProvider(weights, t),
      }),
    );
  }
  ladder.push(createAgentForProfile(profileById('ada'), 99));

  const out: unknown[] = [];
  for (let g = from; g < to; g++) {
    out.push(await playIndexedGame(ladder, g, { seed, seatCount: seats }));
  }
  const line = `__SHARD_RESULT__${JSON.stringify(out)}`;
  if (typeof process !== 'undefined' && process?.stdout) process.stdout.write(`${line}\n`);
  else console.log(line);
}

void main();

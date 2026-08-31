/**
 * One shard of the blend sweep.
 *
 * Every experiment so far asked whether the network should REPLACE the
 * rollout, and the answer was consistently no. This asks a different question:
 * how much of each is best, given that the two are complementary rather than
 * competing.
 *
 * The evidence they are complementary is direct. The network correlates better
 * with the final outcome overall, 0.49 against a rollout's 0.41 over eight
 * samples, and is far worse at separating the moves available right now - a
 * sibling-spread ratio of 0.37 against 0.51. Each is strong exactly where the
 * other is weak. Mixing is the standard answer to that, and it is what AlphaGo
 * did before AlphaZero dropped rollouts on the strength of a much better value
 * network than this one.
 *
 * mix = 0 is the rollout control, mix = 1 is every previous experiment, and the
 * interesting question is whether anything in between beats both ends.
 */
import type { Agent } from '../agent';
import { playIndexedGame } from '../arena';
import { createIsmctsAgent } from '../ismcts';
import { checkpointFs } from './checkpoint';
import { createNetEvaluator } from './evaluator';
import { deserializeWeights, type WeightsMeta } from './serialize';

declare const process:
  | { env?: Record<string, string | undefined>; stdout?: { write: (s: string) => void } }
  | undefined;

/**
 * Equal TIME rather than equal simulations.
 *
 * Every arena in this milestone fixed the simulation count, to isolate
 * evaluation quality from thinking budget. That is the right control for "is
 * this a better evaluator" and the wrong one for "is this a better opponent",
 * because it discards the network's one measured advantage: replacing a ~300us
 * rollout with a 133us forward pass made self-play run in 30 minutes where the
 * rollout took 70. At a fixed clock the network simply searches more, and a
 * player waits on a clock, not on a counter.
 */
async function buildLadder(
  iterations: number,
  dir: string,
  mixes: number[],
  budgetMs: number,
): Promise<Agent[]> {
  const fs = await checkpointFs();
  const meta = JSON.parse(
    new TextDecoder().decode(fs.readFileSync(`${dir}/weights.meta.json`)),
  ) as WeightsMeta;
  const bytes = fs.readFileSync(`${dir}/weights.bin`);
  const cal = JSON.parse(new TextDecoder().decode(fs.readFileSync(`${dir}/calibration.json`))) as {
    valueScale: number;
    valueCenter: number;
  };

  // budgetMs > 0 selects the equal-time comparison; otherwise equal simulations.
  const common =
    budgetMs > 0
      ? ({ budgetMs, maxIterations: 1_000_000, seed: 4242 } as const)
      : ({ maxIterations: iterations, budgetMs: 3_600_000, seed: 4242 } as const);
  return mixes.map((mix) => {
    const name = mix === 0 ? 'Rollout' : `Mix${Math.round(mix * 100)}`;
    if (mix === 0) return createIsmctsAgent({ ...common, name });
    return createIsmctsAgent({
      ...common,
      name,
      evaluatorMix: mix,
      evaluator: createNetEvaluator(deserializeWeights(bytes, meta), name, {
        valueScale: cal.valueScale,
        valueCenter: cal.valueCenter,
      }),
    });
  });
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const from = Number(env.MX_FROM ?? 0);
  const to = Number(env.MX_TO ?? 0);
  const iterations = Number(env.MX_ITERATIONS ?? 400);
  const seed = Number(env.MX_SEED ?? 13579);
  const seats = Number(env.MX_SEATS ?? 3);
  const dir = env.MX_DIR ?? 'training/gen100';
  const mixes = (env.MX_MIXES ?? '0,0.25,0.5,0.75,1').split(',').map(Number);

  const budgetMs = Number(env.MX_BUDGET_MS ?? 0);
  const ladder = await buildLadder(iterations, dir, mixes, budgetMs);
  const out: unknown[] = [];
  for (let g = from; g < to; g++) {
    out.push(await playIndexedGame(ladder, g, { seed, seatCount: seats }));
  }
  const line = `__SHARD_RESULT__${JSON.stringify(out)}`;
  if (typeof process !== 'undefined' && process?.stdout) process.stdout.write(`${line}\n`);
  else console.log(line);
}

void main();

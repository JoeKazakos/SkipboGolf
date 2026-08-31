/**
 * One shard of the generation head-to-head arena.
 *
 * The four generations of the three-player experiment play EACH OTHER, with no
 * rollout control and no roster tier in the pool. Every earlier arena rated a
 * generation against an external control in its own separately-recentered pool,
 * which answers "is this network better than a rollout" but never "is
 * generation 3 better than generation 0". That second question is the one the
 * flywheel is supposed to answer, and it had not been asked.
 *
 * A pure-network pool is the sharpest form of it: with nothing else in the
 * pool, the ratings are entirely a statement about which generation beats which.
 *
 * Both forms of each generation are seated - raw and with that generation's own
 * derived calibration - because calibration reversed sign between generations,
 * so neither form alone is a fair representative of "the network".
 *
 * Three seats, the size these networks were trained for.
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

interface Calibration {
  valueScale: number;
  valueCenter: number;
}

async function buildLadder(iterations: number, first: number, count: number): Promise<Agent[]> {
  const fs = await checkpointFs();
  const common = { maxIterations: iterations, budgetMs: 3_600_000, seed: 4242 } as const;
  const ladder: Agent[] = [];

  for (let i = 0; i < count; i++) {
    const dir = `training/gen${String(first + i).padStart(3, '0')}`;
    const weightsPath = `${dir}/weights.bin`;
    if (!fs.existsSync(weightsPath)) continue;

    const meta = JSON.parse(
      new TextDecoder().decode(fs.readFileSync(`${dir}/weights.meta.json`)),
    ) as WeightsMeta;
    const bytes = fs.readFileSync(weightsPath);
    const cal = JSON.parse(
      new TextDecoder().decode(fs.readFileSync(`${dir}/calibration.json`)),
    ) as Calibration;

    // Raw, and calibrated with the scale this generation derived for itself.
    ladder.push(
      createIsmctsAgent({
        ...common,
        name: `G${i}raw`,
        evaluator: createNetEvaluator(deserializeWeights(bytes, meta), `G${i}raw`),
      }),
    );
    ladder.push(
      createIsmctsAgent({
        ...common,
        name: `G${i}cal`,
        evaluator: createNetEvaluator(deserializeWeights(bytes, meta), `G${i}cal`, {
          valueScale: cal.valueScale,
          valueCenter: cal.valueCenter,
        }),
      }),
    );
  }
  return ladder;
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const from = Number(env.GA_FROM ?? 0);
  const to = Number(env.GA_TO ?? 0);
  const iterations = Number(env.GA_ITERATIONS ?? 400);
  const seed = Number(env.GA_SEED ?? 24680);
  const first = Number(env.GA_FIRST ?? 100);
  const count = Number(env.GA_COUNT ?? 4);
  const seats = Number(env.GA_SEATS ?? 3);

  const ladder = await buildLadder(iterations, first, count);
  const out: unknown[] = [];
  for (let g = from; g < to; g++) {
    out.push(await playIndexedGame(ladder, g, { seed, seatCount: seats }));
  }
  const line = `__SHARD_RESULT__${JSON.stringify(out)}`;
  if (typeof process !== 'undefined' && process?.stdout) process.stdout.write(`${line}\n`);
  else console.log(line);
}

void main();

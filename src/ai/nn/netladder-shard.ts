/**
 * One shard of the network ladder.
 *
 * Every network variant, an UNTRAINED network, the rollout control and the
 * established roster tiers all play in ONE pool, so a single rating fit puts
 * them on one scale. That matters because `summarise` recenters each pool on
 * 1500: the same rollout control read 1513, 1544, 1535 and 1574 across four
 * separate arenas, which makes cross-run Elo meaningless and made several
 * earlier comparisons looser than they appeared. Mean score, being points in
 * the actual game, was always comparable; Elo was not.
 *
 * The untrained network is the baseline the project was missing. It says how
 * much of a variant's rating is the ARCHITECTURE plus the search around it, and
 * how much the training actually bought. A trained network that rates near an
 * untrained one has learned nothing the search can use, whatever its loss curve
 * says.
 *
 * Driven by scripts/netladder.mjs.
 */
import type { Agent } from '../agent';
import { playIndexedGame } from '../arena';
import { createIsmctsAgent } from '../ismcts';
import { createAgentForProfile, profileById } from '../roster';
import { checkpointFs } from './checkpoint';
import { createNetEvaluator } from './evaluator';
import { DEFAULT_ARCH, Net } from './net';
import { deserializeWeights, type WeightsMeta } from './serialize';
import { createSharedEvaluator, deserializeShared, type SharedMeta } from './sharedserialize';
import { DEFAULT_SHARED_ARCH, SharedNet } from './sharednet';

declare const process:
  | {
      env?: Record<string, string | undefined>;
      stdout?: { write: (s: string) => void };
    }
  | undefined;

const CENTER = 0.6436;

async function loadFlat(path: string, name: string, scale: number, reveal: boolean) {
  const fs = await checkpointFs();
  const meta = JSON.parse(
    new TextDecoder().decode(fs.readFileSync(path.replace(/\.bin$/, '.meta.json'))),
  ) as WeightsMeta;
  const net = deserializeWeights(fs.readFileSync(path), meta);
  return createNetEvaluator(net, name, { valueScale: scale, valueCenter: CENTER, reveal });
}

async function loadSharedNet(path: string, name: string, scale: number, reveal: boolean) {
  const fs = await checkpointFs();
  const meta = JSON.parse(
    new TextDecoder().decode(fs.readFileSync(path.replace(/\.bin$/, '.meta.json'))),
  ) as SharedMeta;
  const net = deserializeShared(fs.readFileSync(path), meta);
  return createSharedEvaluator(net, name, { valueScale: scale, valueCenter: CENTER, reveal });
}

async function buildLadder(iterations: number): Promise<Agent[]> {
  const fs = await checkpointFs();
  const common = { maxIterations: iterations, budgetMs: 3_600_000, seed: 4242 } as const;
  const ladder: Agent[] = [];

  // The baseline: a network with random weights, wired in exactly as a trained
  // one is. Nothing about it has been learned.
  ladder.push(
    createIsmctsAgent({
      ...common,
      name: 'Untrained',
      evaluator: createNetEvaluator(Net.create(DEFAULT_ARCH, 987654), 'Untrained'),
    }),
  );

  // An untrained SHARED network too, so the architecture comparison has its own
  // floor and a shared result is not read against the wrong baseline.
  ladder.push(
    createIsmctsAgent({
      ...common,
      name: 'UntrainedSh',
      evaluator: createSharedEvaluator(
        SharedNet.create(DEFAULT_SHARED_ARCH, 987654),
        'UntrainedSh',
      ),
    }),
  );

  const flat = 'training/gen000/weights.bin';
  if (fs.existsSync(flat)) {
    ladder.push(
      createIsmctsAgent({ ...common, name: 'Gen0', evaluator: await loadFlat(flat, 'Gen0', 2.2, false) }),
    );
  }

  const reveal = 'training/gen000/weights-reveal.bin';
  if (fs.existsSync(reveal)) {
    ladder.push(
      createIsmctsAgent({
        ...common,
        name: 'Gen0Rev',
        evaluator: await loadFlat(reveal, 'Gen0Rev', 2.26, true),
      }),
    );
  }

  for (const [path, name, rev] of [
    ['training/gen000/weights-shared.bin', 'Gen0Shared', false],
    ['training/gen000/weights-shared-reveal.bin', 'Gen0ShRev', true],
  ] as const) {
    if (fs.existsSync(path)) {
      ladder.push(
        createIsmctsAgent({
          ...common,
          name,
          evaluator: await loadSharedNet(path, name, 2.2, rev),
        }),
      );
    }
  }

  // The control, and the established tiers as familiar reference points.
  ladder.push(createIsmctsAgent({ ...common, name: 'Rollout' }));
  for (const id of ['nel', 'vin', 'ada', 'rook']) {
    ladder.push(createAgentForProfile(profileById(id), 99));
  }
  return ladder;
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const from = Number(env.NL_FROM ?? 0);
  const to = Number(env.NL_TO ?? 0);
  const iterations = Number(env.NL_ITERATIONS ?? 400);
  const seed = Number(env.NL_SEED ?? 8080808);

  const ladder = await buildLadder(iterations);
  const out: unknown[] = [];
  for (let g = from; g < to; g++) {
    out.push(await playIndexedGame(ladder, g, { seed, seatCount: 6 }));
  }
  const line = `__SHARD_RESULT__${JSON.stringify(out)}`;
  if (typeof process !== 'undefined' && process?.stdout) process.stdout.write(`${line}\n`);
  else console.log(line);
}

void main();

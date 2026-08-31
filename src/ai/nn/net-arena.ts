/**
 * Rates a trained network against the roster.
 *
 * This is the only gate that counts. The project has twice now watched a large
 * improvement in prediction accuracy arrive alongside a large loss in playing
 * strength - once fitting the evaluation to outcomes, once doing the same at
 * the leaf alone - so a network is judged by games won, never by held-out
 * loss. Held-out loss says the network learned the data; only the arena says
 * the data was worth learning.
 *
 * Usage:
 *   NA_WEIGHTS=training/gen000/weights.bin NA_GAMES=200 npm run net:arena
 */
import { createIsmctsAgent } from '../ismcts';
import type { Agent } from '../agent';
import { createAgentForProfile, profileById } from '../roster';
import { playIndexedGame, summarise, formatTable } from '../arena';
import { checkpointFs } from './checkpoint';
import { createNetEvaluator } from './evaluator';
import { deserializeWeights, type WeightsMeta } from './serialize';

declare const process:
  | { argv?: string[]; env?: Record<string, string | undefined>; exit?: (code: number) => void }
  | undefined;

/**
 * Loads weights and their sidecar together.
 *
 * The sidecar carries the architecture and a checksum, so a weights file that
 * does not match this build is refused rather than reinterpreted as noise -
 * silently loading the wrong shape would produce a network that plays badly
 * for a reason no measurement would ever reveal.
 */
export async function loadEvaluator(
  path: string,
  name = 'net',
  calibration: { valueScale?: number; valueCenter?: number } = {},
) {
  const fs = await checkpointFs();
  const metaPath = path.replace(/\.bin$/, '.meta.json');
  if (!fs.existsSync(path)) throw new Error(`net-arena: no weights at ${path}`);
  if (!fs.existsSync(metaPath)) throw new Error(`net-arena: no sidecar at ${metaPath}`);
  const meta = JSON.parse(new TextDecoder().decode(fs.readFileSync(metaPath))) as WeightsMeta;
  const net = deserializeWeights(fs.readFileSync(path), meta);
  return createNetEvaluator(net, name, calibration);
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const weightsPath = env.NA_WEIGHTS ?? 'training/gen000/weights.bin';
  const games = Number(env.NA_GAMES ?? 120);
  const iterations = Number(env.NA_ITERATIONS ?? 400);
  const seed = Number(env.NA_SEED ?? 606060);
  const opponents = (env.NA_OPPONENTS ?? 'nel,vin,ada,rook').split(',');

  const evaluator = await loadEvaluator(weightsPath, 'Net');

  // The calibrated variant, when a scale is given. Same weights, same ordering
  // - only the value head's spread is stretched, so any difference between
  // these two rows is the exploration balance and nothing else.
  const scale = Number(env.NA_SCALE ?? 0);
  const center = Number(env.NA_CENTER ?? 0.6436);
  const calibrated = scale > 0
    ? await loadEvaluator(weightsPath, 'NetCal', { valueScale: scale, valueCenter: center })
    : null;

  // The network agent gets the SAME simulation count as the ISMCTS control, so
  // the comparison isolates evaluation quality rather than rewarding whichever
  // side happens to get more thinking. A fixed count also makes the result
  // reproducible, which a wall-clock budget would not be.
  const netAgent: Agent = createIsmctsAgent({
    name: 'Net',
    evaluator,
    maxIterations: iterations,
    budgetMs: 3_600_000,
    seed: 4242,
  });

  // The control: identical search, identical simulation count, heuristic
  // rollouts instead of the network. Any difference between these two is the
  // network, and nothing else.
  const control: Agent = createIsmctsAgent({
    name: 'Rollout',
    maxIterations: iterations,
    budgetMs: 3_600_000,
    seed: 4242,
  });

  const calibratedAgent: Agent | null = calibrated
    ? createIsmctsAgent({
        name: 'NetCal',
        evaluator: calibrated,
        maxIterations: iterations,
        budgetMs: 3_600_000,
        seed: 4242,
      })
    : null;

  const ladder: Agent[] = [
    ...(calibratedAgent ? [calibratedAgent] : []),
    netAgent,
    control,
    ...opponents.map((id) => createAgentForProfile(profileById(id.trim()), 99)),
  ];

  console.log(
    `net arena: ${games} games, ${iterations} simulations per decision\n` +
      `  weights ${weightsPath}\n` +
      `  ladder ${ladder.map((a) => a.name).join(', ')}`,
  );

  const results = [];
  for (let g = 0; g < games; g++) {
    results.push(await playIndexedGame(ladder, g, { seed, seatCount: Math.min(6, ladder.length) }));
    if ((g + 1) % 10 === 0) console.log(`  ${g + 1}/${games} games`);
  }

  console.log(formatTable(summarise(results)));
  console.log(
    '\nRead the Net row against the Rollout row: same search, same simulation\n' +
      'count, so the gap between them is the network and nothing else.',
  );
}

void main();

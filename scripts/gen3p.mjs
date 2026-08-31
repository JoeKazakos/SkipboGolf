/**
 * The three-player AlphaZero experiment.
 *
 * Runs generations end to end at ONE table size, so each generation's data is
 * concentrated where it will be judged. Generation 0 across all table sizes gave
 * three-player games only about 34,000 samples; this gives them roughly four
 * times that, for a third of the wall clock a six-player generation costs.
 *
 * The question it answers is the one the mixed run could not: does the
 * ALPHAZERO LOOP itself improve anything? Generation 1 plays its games with
 * generation 0's network, so if the flywheel turns at all, strength should rise
 * generation over generation. Every previous result here was a single shot.
 *
 * Each stage is resumable, so this is safe to re-run: self-play skips shards
 * already on disk, and a finished generation is detected and skipped.
 *
 * Usage:
 *   node scripts/gen3p.mjs [--generations 3] [--games 3000] [--first 100]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const viteNode = createRequire(import.meta.url).resolve('vite-node/dist/cli.mjs');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const generations = Number(flag('generations', 3));
const games = Number(flag('games', 3000));
const first = Number(flag('first', 100));
const iterations = Number(flag('iterations', 400));
const epochs = Number(flag('epochs', 30));
const arenaGames = Number(flag('arena-games', 240));
const workers = Number(flag('workers', Math.max(1, os.cpus().length - 2)));
const shards = Number(flag('shards', workers * 10));

const dirOf = (g) => `training/gen${String(g).padStart(3, '0')}`;

function run(cmd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`exited ${c}`))));
  });
}

const started = Date.now();
for (let i = 0; i < generations; i++) {
  const g = first + i;
  const dir = dirOf(g);
  const prev = i === 0 ? null : dirOf(g - 1);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`3-player experiment, generation ${i} (dir ${dir})`);
  console.log('='.repeat(70));

  // Generation 0 bootstraps from the heuristic; later ones play with the
  // previous network, which is the only thing that makes this a loop.
  const selfPlayEnv = {};
  if (prev) {
    const weights = `${prev}/weights.bin`;
    if (!fs.existsSync(weights)) throw new Error(`missing ${weights}`);
    selfPlayEnv.SP_WEIGHTS = weights;
    const calPath = `${prev}/calibration.json`;
    if (fs.existsSync(calPath)) {
      const cal = JSON.parse(fs.readFileSync(calPath, 'utf8'));
      selfPlayEnv.SP_SCALE = String(cal.valueScale);
      selfPlayEnv.SP_CENTER = String(cal.valueCenter);
      console.log(`  self-play uses ${weights} at scale ${cal.valueScale.toFixed(3)}`);
    }
  } else {
    console.log('  self-play bootstraps from the heuristic rollout agent');
  }

  await run(
    [process.execPath, 'scripts/selfplay-parallel.mjs',
      '--gen', String(g), '--games', String(games), '--iterations', String(iterations),
      '--workers', String(workers), '--shards', String(shards),
      '--seed', String(777000 + g * 1000), '--players', '3'],
    selfPlayEnv,
  );

  await run([process.execPath, viteNode, 'src/ai/nn/train-run.ts'], {
    TR_GENERATION: String(g), TR_EPOCHS: String(epochs), TR_SHARDS: String(shards),
  });

  const cal = JSON.parse(fs.readFileSync(`${dir}/calibration.json`, 'utf8'));
  await run([process.execPath, viteNode, 'src/ai/nn/net-arena.ts'], {
    NA_WEIGHTS: `${dir}/weights.bin`,
    NA_GAMES: String(arenaGames),
    NA_ITERATIONS: String(iterations),
    NA_SCALE: String(cal.valueScale),
    NA_CENTER: String(cal.valueCenter),
    NA_SEATS: '3',
    NA_OPPONENTS: 'ada',
  });
}

console.log(`\nfinished ${generations} generations in ${((Date.now() - started) / 3600000).toFixed(2)}h`);
console.log('Read each generation\'s NetCal row against its Rollout row, and read the');
console.log('generations against each other: a loop that works climbs, one that does not is flat.');

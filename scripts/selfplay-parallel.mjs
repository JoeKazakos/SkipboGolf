/**
 * Generates a self-play generation across several processes.
 *
 * Every game's seed and table size derive from its index alone, and the search
 * is stopped by a fixed simulation count rather than a clock, so games are
 * embarrassingly parallel AND reproducible: sharding changes the wall clock
 * and nothing else.
 *
 * Two things this gets right that the first version did not.
 *
 * SHARDS ARE DECOUPLED FROM WORKERS, and there are many more of them. A shard
 * is written only when it finishes, so a shard is the unit of work that a kill
 * can destroy. One shard per worker meant a process killed at game 59 of 60
 * lost an hour; small shards mean it loses a couple of minutes. Workers pull
 * from a queue, so the count of shards is a durability knob and the count of
 * workers is a throughput knob, which is what they always should have been.
 *
 * PROGRESS IS VISIBLE. Worker output is streamed rather than buffered until
 * exit, because a run that prints nothing for four hours is indistinguishable
 * from a run that has hung.
 *
 * Usage:
 *   node scripts/selfplay-parallel.mjs [--gen N] [--games N] [--iterations N]
 *                                      [--workers K] [--shards M] [--seed N]
 *                                      [--players 6,4,5]
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const generation = Number(flag('gen', 0));
const games = Number(flag('games', 64));
const iterations = Number(flag('iterations', 400));
const seed = Number(flag('seed', 20260830));
const players = flag('players', '');
const workers = Math.max(
  1,
  Math.min(Number(flag('workers', Math.max(1, os.cpus().length - 2))), games),
);
// Four shards per worker by default: enough that a kill costs minutes, few
// enough that process startup stays a rounding error.
const shards = Math.max(workers, Math.min(Number(flag('shards', workers * 4)), games));

const dir = `training/gen${String(generation).padStart(3, '0')}`;
console.log(
  `self-play: generation ${generation}, ${games} games at ${iterations} simulations ` +
    `per decision`,
);
console.log(`  ${shards} shards over ${workers} worker processes`);
console.log(`  writing to ${dir}/shards/  (already-complete shards are skipped)`);

const started = Date.now();
const results = [];
let finished = 0;
let nextShard = 0;

const cliPath = createRequire(import.meta.url).resolve('vite-node/dist/cli.mjs');

function runShard(shard) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'src/ai/nn/selfplay-shard.ts'], {
      env: {
        ...process.env,
        SP_GENERATION: String(generation),
        SP_GAMES: String(games),
        SP_ITERATIONS: String(iterations),
        SP_SEED: String(seed),
        SP_SHARD: String(shard),
        SP_SHARDS: String(shards),
        ...(players ? { SP_PLAYERS: players } : {}),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`shard ${shard} exited ${code}`));
      const marker = out.lastIndexOf('__SHARD_RESULT__');
      if (marker < 0) return reject(new Error(`shard ${shard} produced no result: ${out.slice(-300)}`));
      const result = JSON.parse(out.slice(marker + '__SHARD_RESULT__'.length).trim());
      finished += 1;
      const elapsed = (Date.now() - started) / 1000;
      const done = results.length + 1;
      // `elapsed / done` is already wall clock per completed shard, and with W
      // shards running at once that quantity ALREADY carries the parallelism.
      // Dividing by the worker count again underestimates by exactly W - which
      // this did, reading 3 minutes for an hour of work, after an earlier
      // version overestimated by the same factor for the mirror-image reason.
      const eta = (elapsed / done) * (shards - done);
      console.log(
        `[${finished}/${shards}] shard ${shard}: ${result.samples} samples` +
          `${result.skipped ? ' (already on disk)' : ` in ${result.seconds.toFixed(0)}s`}` +
          `  eta ${(eta / 60).toFixed(1)} min`,
      );
      resolve(result);
    });
  });
}

/** One worker: pulls the next shard index until the queue is empty. */
async function worker() {
  for (;;) {
    const shard = nextShard++;
    if (shard >= shards) return;
    results.push(await runShard(shard));
  }
}

await Promise.all(Array.from({ length: workers }, () => worker()));

const seconds = (Date.now() - started) / 1000;
const samples = results.reduce((n, r) => n + r.samples, 0);
const replayed = results.filter((r) => !r.skipped);

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  `${dir}/manifest.json`,
  JSON.stringify(
    {
      config: { generation, games, iterations, seed, players: players || 'default', shards },
      shards,
      completed: Object.fromEntries(results.map((r) => [r.shard, r.samples])),
      totalSamples: samples,
      updated: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(
  `\n  ${samples} samples in ${(seconds / 60).toFixed(1)} min ` +
    `(${replayed.length} shards played, ${results.length - replayed.length} reused)`,
);
if (replayed.length > 0) {
  const playedSamples = replayed.reduce((n, r) => n + r.samples, 0);
  const rate = playedSamples / seconds;
  console.log(
    `  throughput ${rate.toFixed(1)} samples/s -> ${(1e6 / rate / 3600).toFixed(1)}h per million`,
  );
}
console.log(`  manifest: ${dir}/manifest.json`);

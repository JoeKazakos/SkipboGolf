/**
 * Generates a self-play generation across several processes.
 *
 * Every game's seed and table size derive from its index alone, and the search
 * is stopped by a fixed iteration count rather than a clock, so games are
 * embarrassingly parallel AND reproducible: sharding changes the wall clock
 * and nothing else.
 *
 * The run is resumable. Shards already on disk are read back instead of
 * replayed, so a generation killed after five hours resumes where it stopped
 * rather than starting again. Re-running with the same arguments is safe and
 * cheap.
 *
 * Usage:
 *   node scripts/selfplay-parallel.mjs [--gen N] [--games N] [--iterations N]
 *                                      [--workers K] [--seed N] [--players 6,4,5]
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

const dir = `training/gen${String(generation).padStart(3, '0')}`;
console.log(
  `self-play: generation ${generation}, ${games} games at ${iterations} simulations ` +
    `per decision, over ${workers} processes`,
);
console.log(`  writing to ${dir}/shards/  (already-complete shards are skipped)`);

const started = Date.now();
let finished = 0;

function runShard(shard) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [createRequire(import.meta.url).resolve('vite-node/dist/cli.mjs'), 'src/ai/nn/selfplay-shard.ts'],
      {
        env: {
          ...process.env,
          SP_GENERATION: String(generation),
          SP_GAMES: String(games),
          SP_ITERATIONS: String(iterations),
          SP_SEED: String(seed),
          SP_SHARD: String(shard),
          SP_SHARDS: String(workers),
          ...(players ? { SP_PLAYERS: players } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`shard ${shard} exited ${code}: ${err.slice(-600)}`));
      }
      const marker = out.lastIndexOf('__SHARD_RESULT__');
      if (marker < 0) return reject(new Error(`shard ${shard} produced no result: ${out.slice(-300)}`));
      const result = JSON.parse(out.slice(marker + '__SHARD_RESULT__'.length).trim());
      finished += 1;
      process.stdout.write(
        `\r  ${finished}/${workers} shards  (${result.samples} samples` +
          `${result.skipped ? ', already on disk' : ''})          `,
      );
      resolve(result);
    });
  });
}

const results = await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i)));
const seconds = (Date.now() - started) / 1000;
const samples = results.reduce((n, r) => n + r.samples, 0);
const replayed = results.filter((r) => !r.skipped).length;

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  `${dir}/manifest.json`,
  JSON.stringify(
    {
      config: { generation, games, iterations, seed, players: players || 'default' },
      shards: workers,
      completed: Object.fromEntries(results.map((r) => [r.shard, r.samples])),
      totalSamples: samples,
      updated: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(`\n  ${samples} samples in ${seconds.toFixed(1)}s (${replayed} shards played, ${workers - replayed} reused)`);
if (replayed > 0) {
  const rate = samples / seconds;
  console.log(`  throughput ${rate.toFixed(0)} samples/s -> ${(1e6 / rate / 3600).toFixed(1)}h per million`);
}
console.log(`  manifest: ${dir}/manifest.json`);

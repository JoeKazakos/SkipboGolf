/**
 * Runs the self-play arena across several processes.
 *
 * The engine is pure and every game's seed and seating derive from its index
 * alone, so games are embarrassingly parallel: sharding changes the wall clock
 * and nothing else. Ratings are fitted once, over the merged results.
 *
 * Usage:
 *   node scripts/arena-parallel.mjs [--games N] [--workers K] [--roster] [--budget MS]
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const games = Number(flag('games', 120));
const workers = Math.max(1, Math.min(Number(flag('workers', Math.max(1, os.cpus().length - 2))), games));
const roster = args.includes('--roster');
const budget = flag('budget', roster ? '' : '250');
const seed = Number(flag('seed', 20260828));

// Contiguous blocks keep each shard's indices simple to reason about.
const bounds = [];
for (let w = 0; w < workers; w++) {
  const from = Math.floor((w * games) / workers);
  const to = Math.floor(((w + 1) * games) / workers);
  if (to > from) bounds.push([from, to]);
}

console.log(
  `arena: ${games} games over ${bounds.length} processes` +
    (roster ? ' (roster ladder, each profile at its own budget)' : ` at ${budget}ms`),
);

const started = Date.now();
let done = 0;

function runShard([from, to]) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [createRequire(import.meta.url).resolve('vite-node/dist/cli.mjs'), 'src/ai/arena-shard.ts'],
      {
        env: {
          ...process.env,
          SHARD_FROM: String(from),
          SHARD_TO: String(to),
          ARENA_SEED: String(seed),
          ARENA_ROSTER: roster ? '1' : '0',
          ...(budget ? { ARENA_BUDGET_MS: String(budget) } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`shard ${from}-${to} exited ${code}: ${err.slice(-500)}`));
      const marker = out.lastIndexOf('__SHARD_RESULT__');
      if (marker < 0) return reject(new Error(`shard ${from}-${to} produced no result: ${out.slice(-300)}`));
      const json = out.slice(marker + '__SHARD_RESULT__'.length).trim();
      done += to - from;
      process.stdout.write(`\r  ${done}/${games} games`);
      resolve(JSON.parse(json));
    });
  });
}

const chunks = await Promise.all(bounds.map(runShard));
const results = chunks.flat();
console.log(`\n  played ${results.length} games in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// Fit ratings once, over everything.
const { summarise, formatTable } = await import('../src/ai/arena-exports.ts').catch(async () => {
  // arena-exports is TypeScript; load it through vite-node's runtime instead.
  const { createServer } = await import('vite');
  const server = await createServer({ server: { middlewareMode: true } });
  const mod = await server.ssrLoadModule('/src/ai/arena-exports.ts');
  await server.close();
  return mod;
});

const report = summarise(results);
console.log(formatTable(report));

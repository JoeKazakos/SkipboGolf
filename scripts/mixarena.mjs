/**
 * Rates every network variant, an untrained network, the rollout control and
 * the roster tiers in ONE pool, across several processes.
 *
 * One pool matters: summarise recenters each pool on 1500, so ratings from
 * separate arenas are not comparable. Running everything together is what makes
 * "the untrained network rates X and the trained one rates Y" a real sentence.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const games = Number(flag('games', 240));
const iterations = Number(flag('iterations', 400));
const seed = Number(flag('seed', 24680));
const workers = Math.max(1, Math.min(Number(flag('workers', Math.max(1, os.cpus().length - 2))), games));

const bounds = [];
for (let w = 0; w < workers; w++) {
  const from = Math.floor((w * games) / workers);
  const to = Math.floor(((w + 1) * games) / workers);
  if (to > from) bounds.push([from, to]);
}

console.log(`blend sweep: ${games} games at ${iterations} simulations, ${bounds.length} processes`);
const started = Date.now();
let done = 0;
const cli = createRequire(import.meta.url).resolve('vite-node/dist/cli.mjs');

function runShard([from, to]) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'src/ai/nn/mix-arena-shard.ts'], {
      env: { ...process.env, MX_FROM: String(from), MX_TO: String(to), MX_ITERATIONS: String(iterations), MX_SEED: String(seed) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`shard ${from}-${to} exited ${code}: ${err.slice(-600)}`));
      const m = out.lastIndexOf('__SHARD_RESULT__');
      if (m < 0) return reject(new Error(`shard ${from}-${to} produced no result: ${out.slice(-300)}`));
      done += to - from;
      process.stdout.write(`\r  ${done}/${games} games`);
      resolve(JSON.parse(out.slice(m + '__SHARD_RESULT__'.length).trim()));
    });
  });
}

const chunks = await Promise.all(bounds.map(runShard));
const results = chunks.flat();
console.log(`\n  played ${results.length} games in ${((Date.now() - started) / 60000).toFixed(1)} min`);

const { createServer } = await import('vite');
const server = await createServer({ server: { middlewareMode: true } });
const mod = await server.ssrLoadModule('/src/ai/arena-exports.ts');
await server.close();
console.log(mod.formatTable(mod.summarise(results)));
console.log('\nOne pool, one rating fit. Untrained is the floor: a trained network');
console.log('near it has learned nothing the search can use, whatever its loss says.');

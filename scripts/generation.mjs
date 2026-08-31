/**
 * Runs one AlphaZero generation end to end: self-play, training, then the
 * arena that decides whether the result is worth keeping.
 *
 * Every stage is resumable on its own, so this script is safe to re-run. It
 * skips self-play shards already on disk, resumes training from the newest
 * checkpoint, and re-runs only the arena, which is a fresh measurement by
 * nature. Killing it mid-generation costs minutes, not the generation.
 *
 * The arena is the gate, and it compares against a CONTROL running the
 * identical search at the identical simulation count with heuristic rollouts.
 * This project has twice watched a large gain in prediction accuracy arrive
 * with a large loss in playing strength, so no network is judged by its loss
 * curve.
 *
 * Usage:
 *   node scripts/generation.mjs --gen 1 [--games 6000] [--iterations 400]
 *                               [--epochs 40] [--arena-games 200] [--skip-selfplay]
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Resolve vite-node the same way selfplay-parallel does, rather than guessing
// a path inside node_modules that a different install layout would not have.
const viteNode = createRequire(import.meta.url).resolve('vite-node/dist/cli.mjs');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const generation = Number(flag('gen', 0));
const games = Number(flag('games', 6000));
const iterations = Number(flag('iterations', 400));
const epochs = Number(flag('epochs', 40));
const arenaGames = Number(flag('arena-games', 200));
const workers = Number(flag('workers', Math.max(1, os.cpus().length - 2)));
const shards = Number(flag('shards', workers * 14));
const seed = Number(flag('seed', 20260830 + generation * 1000));

const dir = `training/gen${String(generation).padStart(3, '0')}`;
const previous = generation > 0 ? `training/gen${String(generation - 1).padStart(3, '0')}` : null;

function run(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exited ${code}`))));
  });
}

const started = Date.now();
console.log(`\n=== generation ${generation} ===`);

// 1. Self-play. From generation 1 on, the PREVIOUS generation's network plays
//    the games, which is the iteration that makes this AlphaZero rather than
//    one round of supervised imitation.
if (!has('skip-selfplay')) {
  const priorWeights = previous ? `${previous}/weights.bin` : null;
  if (priorWeights && !fs.existsSync(priorWeights)) {
    console.error(`generation ${generation} needs ${priorWeights}, which does not exist`);
    process.exit(1);
  }
  console.log(`\n[1/3] self-play${priorWeights ? ` using ${priorWeights}` : ' (heuristic bootstrap)'}`);
  await run(
    [
      process.execPath,
      'scripts/selfplay-parallel.mjs',
      '--gen', String(generation),
      '--games', String(games),
      '--iterations', String(iterations),
      '--workers', String(workers),
      '--shards', String(shards),
      '--seed', String(seed),
    ],
    priorWeights ? { SP_WEIGHTS: priorWeights } : {},
  );
}

// 2. Training.
console.log(`\n[2/3] training`);
await run([process.execPath, viteNode, 'src/ai/nn/train-run.ts'], {
  TR_GENERATION: String(generation),
  TR_EPOCHS: String(epochs),
  TR_SHARDS: String(shards),
});

// 3. The gate.
console.log(`\n[3/3] arena`);
await run([process.execPath, viteNode, 'src/ai/nn/net-arena.ts'], {
  NA_WEIGHTS: `${dir}/weights.bin`,
  NA_GAMES: String(arenaGames),
  NA_ITERATIONS: String(iterations),
});

console.log(
  `\n=== generation ${generation} finished in ${((Date.now() - started) / 3600000).toFixed(2)}h ===`,
);
console.log(
  'Keep this generation only if the Net row beats the Rollout row. Loss curves\n' +
    'do not decide that, and have twice pointed the wrong way in this project.',
);

/**
 * A repeatable benchmark for the search and the pieces it is built from.
 *
 * Every performance claim about this project should be reproducible, and until
 * now they were not: the numbers in `docs/ideas.md` were taken by hand, some of
 * them with an arena running in the background, which inflated them by an
 * unknown amount. That has already caused one wrong conclusion. So this file
 * fixes the position, fixes the budgets, and prints how many other node
 * processes were competing at the time, because a benchmark whose load is not
 * stated is not a measurement.
 *
 * Run it with `npm run bench`.
 */
import { makeRng, type Rng } from '../engine/rng';
import { applyAction, clone, createInitialState, legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import {
  DEFAULT_EVAL_PARAMS,
  expectedScore,
  gridView,
  policyPriors,
  rolloutAction,
} from './heuristic';
import { determinize, ismctsSearch } from './ismcts';

/** Node globals, declared locally because the project deliberately omits @types/node. */
declare const process:
  | {
      argv?: string[];
      env?: Record<string, string | undefined>;
      platform?: string;
      pid?: number;
    }
  | undefined;

/**
 * The position every number below is taken at.
 *
 * Fixed seed, fixed number of random-but-legal actions: mid-round, so grids are
 * part filled, discard piles exist and the unseen-card census has narrowed, all
 * of which change what the search costs. An opening position would be both
 * unrepresentative and easier than the average decision.
 */
const POSITION_SEED = 20260830;
const POSITION_STEPS = 60;

/** Budgets that make the depth-scaling visible: cost per iteration rises as the tree deepens. */
const BUDGETS_MS = [100, 250, 1000, 4000];

/**
 * Somewhere to put results so nothing measured here can be optimised away.
 * Printed at the end purely to keep it live.
 */
let sink = 0;

function advance(seed: number, steps: number): GameState {
  const rng = makeRng(seed);
  let s = createInitialState(seed);
  for (let i = 0; i < steps && !s.terminal; i++) {
    const legal = legalActions(s);
    s = applyAction(s, legal[Math.floor(rng.next() * legal.length)]);
  }
  return s;
}

/**
 * Microseconds per call, timed in batches until `targetMs` has passed rather
 * than over a fixed count, so a cheap call and an expensive one are both
 * measured over enough work to mean something.
 */
function measure(fn: () => void, targetMs = 250): number {
  for (let i = 0; i < 64; i++) fn();
  let calls = 0;
  let elapsed = 0;
  const start = performance.now();
  do {
    for (let i = 0; i < 32; i++) fn();
    calls += 32;
    elapsed = performance.now() - start;
  } while (elapsed < targetMs);
  return (elapsed * 1000) / calls;
}

/**
 * How many node processes are alive, or null if the platform would not say.
 *
 * `npm run bench` is itself two of them - npm's own node and this one - so the
 * count is reported against that baseline rather than against zero.
 */
async function countNodeProcesses(): Promise<number | null> {
  try {
    // Imported through a variable so the type checker, which has no node types
    // here, does not have to resolve a builtin the browser build never sees.
    const specifier = 'node:child_process';
    const cp = (await import(/* @vite-ignore */ specifier)) as {
      execSync: (cmd: string, opts: { encoding: 'utf8' }) => string;
    };
    const windows = (typeof process !== 'undefined' && process?.platform) === 'win32';
    const out = windows
      ? cp.execSync('tasklist /FI "IMAGENAME eq node.exe" /NH', { encoding: 'utf8' })
      : cp.execSync('ps -e -o comm=', { encoding: 'utf8' });
    const lines = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return windows
      ? lines.filter((line) => line.toLowerCase().startsWith('node.exe')).length
      : lines.filter((line) => line.endsWith('node')).length;
  } catch {
    return null;
  }
}

/** The `estimateScores` an unfinished rollout falls back on, replicated so the bench can time it. */
function estimateScores(s: GameState): number[] {
  return s.players.map((p) =>
    expectedScore(gridView(p.grid), DEFAULT_EVAL_PARAMS.hiddenEv, DEFAULT_EVAL_PARAMS.pMatch),
  );
}

function componentCosts(s: GameState, actions: readonly Action[], rng: Rng): [string, number][] {
  const first: Action = actions[0];
  return [
    ['legalActions', measure(() => void (sink += legalActions(s).length))],
    ['clone', measure(() => void (sink += clone(s).turnCount))],
    ['applyAction', measure(() => void (sink += applyAction(s, first).turnCount))],
    ['determinize', measure(() => void (sink += determinize(s, s.current, rng).turnCount))],
    ['policyPriors', measure(() => void (sink += policyPriors(s, actions)[0]))],
    ['rolloutAction', measure(() => void (sink += rolloutAction(s, rng).type.length))],
    ['estimateScores', measure(() => void (sink += estimateScores(s)[0]))],
  ];
}

/**
 * Iterations achieved at each budget, reported per iteration.
 *
 * Two passes. With rollouts disabled only the descent is timed, which is where
 * the prior work lives and where the depth scaling shows most clearly; the
 * second pass is what an agent actually pays. `maxIterations` is lifted well
 * clear so the clock is the only thing that stops either one.
 */
function searchCosts(s: GameState, rolloutTurnLimit: number): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (const budgetMs of BUDGETS_MS) {
    const started = performance.now();
    const result = ismctsSearch(s, s.current, {
      budgetMs,
      maxIterations: 100_000_000,
      seed: 4242,
      rolloutTurnLimit,
    });
    const elapsed = performance.now() - started;
    rows.push([budgetMs, result.iterations, (elapsed * 1000) / Math.max(1, result.iterations)]);
  }
  return rows;
}

function formatRows(rows: [number, number, number][]): string {
  return rows
    .map(
      ([budgetMs, iters, perIter]) =>
        `  ${String(budgetMs).padStart(5)}ms: ${iters.toLocaleString('en-US').padStart(9)} iters` +
        ` -> ${perIter.toFixed(0).padStart(4)}us each`,
    )
    .join('\n');
}

async function main(): Promise<void> {
  const s = advance(POSITION_SEED, POSITION_STEPS);
  const actions = legalActions(s);
  if (s.terminal || actions.length < 2) {
    throw new Error('benchmark position has no decision in it; adjust POSITION_STEPS');
  }
  const rng = makeRng(1234567);

  console.log('skip-bo golf search benchmark');
  console.log(
    `position: seed ${POSITION_SEED}, ${POSITION_STEPS} actions applied,` +
      ` player ${s.current} to act, phase ${s.phase}, ${actions.length} legal actions,` +
      ` turn ${s.turnCount}`,
  );

  const nodes = await countNodeProcesses();
  if (nodes == null) {
    console.log('load: could not count node processes; assume nothing about the load');
  } else if (nodes > 2) {
    console.log(
      `WARNING: ${nodes} node processes are running. Two of those are npm and this` +
        ' benchmark; the rest are competing for the CPU and inflate every number below.' +
        ' Stop background arenas and re-run before believing a comparison.',
    );
  } else {
    console.log(`load: ${nodes} node processes, which is just npm and this benchmark`);
  }

  console.log('\ncomponent costs, per call:');
  for (const [label, us] of componentCosts(s, actions, rng)) {
    console.log(`  ${label.padEnd(14)} ${us.toFixed(2).padStart(6)}us`);
  }

  console.log('\ndescent only (rollouts disabled), per iteration:');
  console.log(formatRows(searchCosts(s, 0)));

  console.log('\nfull search (default rollout limit), per iteration:');
  console.log(formatRows(searchCosts(s, 8)));

  console.log(`\n(checksum ${sink.toFixed(3)}, printed only so nothing above is dead code)`);
}

/**
 * Only run when this file is the script being executed. vite-node hides the
 * entry path from `process.argv`, so `npm run bench` passes an explicit
 * `--bench` flag; importing this module never starts a benchmark.
 */
const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--bench')) void main();

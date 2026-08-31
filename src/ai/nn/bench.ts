import { Net, type NetArch } from './net';
import { MAX_SEATS, POLICY_SIZE } from './contracts';
import { makeRng } from '../../engine/rng';

/**
 * Forward-pass benchmark: `npm run bench:nn`.
 *
 * The whole project rests on one number. The heuristic rollout this network
 * replaces costs 300-500 us per ISMCTS iteration; if the forward pass is not
 * comfortably under 50 us the swap stops being a clear win and the plan is
 * not worth executing. So the architecture is chosen from this measurement
 * rather than from a guess about what "small" means.
 *
 * Method: a fixed random input, a long warm-up so the JIT has settled and the
 * loop is running optimised code, then a timed run. The result is reported as
 * the median of several rounds, because a single round picks up whatever GC
 * or scheduler noise happened to land in it.
 */

const INPUT_SIZE = 400;

function benchArch(hidden: number[], rounds = 7, iterations = 40000): number {
  const arch: NetArch = {
    inputSize: INPUT_SIZE,
    hidden,
    valueSize: MAX_SEATS,
    policySize: POLICY_SIZE,
  };
  const net = Net.create(arch, 12345);
  const rng = makeRng(999);
  const input = new Float32Array(INPUT_SIZE);
  for (let i = 0; i < input.length; i++) input[i] = rng.next();

  // Warm up until the JIT has certainly tiered up. Reading a value out of the
  // result stops a clever engine from deciding the call has no effect.
  let sink = 0;
  for (let i = 0; i < 20000; i++) sink += net.forward(input).value[0];

  const times: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink += net.forward(input).value[0];
    times.push(((performance.now() - start) * 1000) / iterations);
  }
  if (sink === Infinity) throw new Error('unreachable');
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

const CANDIDATES: number[][] = [[64], [96], [128], [192], [256], [64, 64], [128, 128], [256, 256]];

export function runBench(): void {
  const arch: NetArch = {
    inputSize: INPUT_SIZE,
    hidden: [],
    valueSize: MAX_SEATS,
    policySize: POLICY_SIZE,
  };
  console.log(`forward pass, input ${INPUT_SIZE} floats, budget 50 us`);
  console.log('hidden          params      us/forward   headroom');
  for (const hidden of CANDIDATES) {
    const us = benchArch(hidden);
    const params = new Net({ ...arch, hidden }).parameterCount();
    const verdict = us < 50 ? `${(50 / us).toFixed(1)}x` : 'OVER BUDGET';
    console.log(
      `[${hidden.join(',')}]`.padEnd(14) +
        String(params).padStart(9) +
        us.toFixed(2).padStart(14) +
        verdict.padStart(12),
    );
  }
}

/**
 * Only benchmark when this file is the script being run. Same trick as
 * `arena.ts`: vite-node hides the entry path, so the npm script passes a flag.
 */
declare const process: { argv?: string[] } | undefined;
const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--bench-nn')) runBench();

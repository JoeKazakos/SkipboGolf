/**
 * Searches the two evaluation parameters for PLAYING STRENGTH rather than
 * prediction accuracy.
 *
 * Fitting them to predict final scores made the agent markedly worse, so this
 * optimises the objective that actually matters: each candidate plays a table
 * against the hand-set values, and is judged on mean score.
 */
import { createHeuristicAgent, DEFAULT_EVAL_PARAMS, type EvalParams } from './heuristic';
import { runArena } from './arena';

declare const process: { argv?: string[]; env?: Record<string, string | undefined> } | undefined;

async function score(params: EvalParams, games: number, seed: number) {
  const ladder = [
    createHeuristicAgent('cand', false, params),
    createHeuristicAgent('base'),
    createHeuristicAgent('cand', false, params),
    createHeuristicAgent('base'),
    createHeuristicAgent('cand', false, params),
    createHeuristicAgent('base'),
  ];
  const report = await runArena(ladder, { games, seed, seatCount: 6 });
  const cand = report.summaries.find((s) => s.name === 'cand')!;
  const base = report.summaries.find((s) => s.name === 'base')!;
  return {
    diff: cand.meanScore - base.meanScore, // negative is better
    stderr: Math.hypot(cand.scoreStdErr, base.scoreStdErr),
    cand: cand.meanScore,
    base: base.meanScore,
  };
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const games = Number(env.SWEEP_GAMES ?? 120);

  // Ranges are configurable so a sweep that runs to the edge of its grid can
  // be extended without editing code - the first one peaked at its own
  // boundary, which is how an optimum gets missed.
  const evs = (env.SWEEP_EV ?? '2.5,3.5,4.44,5.5,7.0').split(',').map(Number);
  const ps = (env.SWEEP_P ?? '0,0.035,0.068,0.15,0.3').split(',').map(Number);

  console.log(`sweeping ${evs.length * ps.length} points, ${games} games each`);
  console.log(`hand-set is ev ${DEFAULT_EVAL_PARAMS.hiddenEv.toFixed(2)}, p ${DEFAULT_EVAL_PARAMS.pMatch.toFixed(3)}`);
  console.log('');
  console.log('  ev     p       cand   base    diff   +/-   verdict');

  const results: { ev: number; p: number; diff: number; stderr: number }[] = [];
  for (const ev of evs) {
    for (const p of ps) {
      const r = await score({ hiddenEv: ev, pMatch: p }, games, 4242);
      const sig = Math.abs(r.diff) > 2 * r.stderr;
      const verdict = !sig ? 'same' : r.diff < 0 ? 'BETTER' : 'worse';
      console.log(
        `  ${ev.toFixed(2).padStart(5)} ${p.toFixed(3).padStart(6)} ` +
          `${r.cand.toFixed(2).padStart(7)} ${r.base.toFixed(2).padStart(6)} ` +
          `${r.diff.toFixed(2).padStart(7)} ${r.stderr.toFixed(2).padStart(5)}   ${verdict}`,
      );
      results.push({ ev, p, diff: r.diff, stderr: r.stderr });
    }
  }

  const best = results.reduce((a, b) => (b.diff < a.diff ? b : a));
  console.log('');
  console.log(
    `best by mean score: ev ${best.ev}, p ${best.p} (diff ${best.diff.toFixed(2)} +/- ${best.stderr.toFixed(2)})`,
  );
}

const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--sweep')) void main();

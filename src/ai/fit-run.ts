/**
 * Fits the evaluation to self-play outcomes and reports the result.
 * Run with: npm run fit
 */
import { createHeuristicAgent } from './heuristic';
import { collectSamples, fitParameters, meanSquaredError } from './fit';
import { DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH } from './heuristic';

declare const process: { argv?: string[]; env?: Record<string, string | undefined> } | undefined;

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const games = Number(env.FIT_GAMES ?? 120);
  const holdout = Number(env.FIT_HOLDOUT ?? 40);

  console.log(`collecting from ${games} training + ${holdout} held-out games...`);
  const agent = createHeuristicAgent();
  const train = await collectSamples(agent, { games, seed: 1 });
  // A separate set of games, so the reported gain is not just a closer fit to
  // the data the parameters were chosen on.
  const test = await collectSamples(agent, { games: holdout, seed: 900_000 });

  const fit = fitParameters(train);
  const testBaseline = meanSquaredError(test, DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH);
  const testFitted = meanSquaredError(test, fit.hiddenEv, fit.pMatch);

  console.log('');
  console.log(`samples:        ${fit.samples} train, ${test.length} test`);
  console.log(`hand-set:       HIDDEN_EV ${DEFAULT_HIDDEN_EV.toFixed(3)}  P_MATCH ${DEFAULT_P_MATCH.toFixed(4)}`);
  console.log(`fitted:         HIDDEN_EV ${fit.hiddenEv.toFixed(3)}  P_MATCH ${fit.pMatch.toFixed(4)}`);
  console.log('');
  console.log(`train MSE:      ${fit.baselineMse.toFixed(2)} -> ${fit.mse.toFixed(2)}  (${fit.improvement.toFixed(1)}% better)`);
  console.log(`HELD-OUT MSE:   ${testBaseline.toFixed(2)} -> ${testFitted.toFixed(2)}  (${((1 - testFitted / testBaseline) * 100).toFixed(1)}% better)`);
  console.log('');
  console.log('The held-out number is the one that counts.');
}

const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--fit')) void main();

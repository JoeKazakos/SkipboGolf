/**
 * Does the fitted evaluation actually play better?
 *
 * Lower prediction error does not automatically mean stronger play, so the
 * fitted parameters are put on the table against the hand-set ones at the same
 * search budget. Six seats, three of each, so every game is a direct
 * comparison.
 */
import { createHeuristicAgent, type EvalParams } from './heuristic';
import { createIsmctsAgent } from './ismcts';
import { runArena, formatTable } from './arena';
import type { Agent } from './agent';

declare const process: { argv?: string[]; env?: Record<string, string | undefined> } | undefined;

const FITTED: EvalParams = {
  hiddenEv: Number((typeof process !== 'undefined' && process?.env?.FIT_EV) ?? 2.765),
  pMatch: Number((typeof process !== 'undefined' && process?.env?.FIT_P) ?? 0.7132),
};

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const games = Number(env.ARENA_GAMES ?? 90);
  const budgetMs = Number(env.ARENA_BUDGET_MS ?? 120);
  const mode = env.FIT_MODE ?? 'ismcts';

  // FIT_TARGET=leaf puts the fitted values only on the leaf estimate, leaving
  // move ranking on the hand-set ones. That is the split the earlier
  // experiment failed to make.
  const target = env.FIT_TARGET ?? 'both';
  const make = (name: string, params?: EvalParams): Agent => {
    if (mode === 'heuristic') return createHeuristicAgent(name, false, params);
    if (params && target === 'leaf') {
      return createIsmctsAgent({ name, budgetMs, seed: 11, leafParams: params });
    }
    return createIsmctsAgent({ name, budgetMs, seed: 11, evalParams: params });
  };

  // Alternating seats so neither side keeps a positional edge.
  const ladder = [
    make('fitted', FITTED),
    make('handset'),
    make('fitted', FITTED),
    make('handset'),
    make('fitted', FITTED),
    make('handset'),
  ];

  console.log(
    `${mode}: fitted (ev ${FITTED.hiddenEv}, p ${FITTED.pMatch}) vs hand-set, ` +
      `${games} games${mode === 'ismcts' ? ` at ${budgetMs}ms` : ''}`,
  );
  const report = await runArena(ladder, { games, seed: 555, seatCount: 6 });
  console.log(formatTable(report));
}

const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--fit-arena')) void main();

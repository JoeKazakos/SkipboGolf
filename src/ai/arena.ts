import { makeRng } from '../engine/rng';
import { NUM_PLAYERS, applyAction, createInitialState, isTerminal, returns } from '../engine/state';
import type { GameState } from '../engine/types';
import { createRandomAgent, type Agent } from './agent';
import { createHeuristicAgent } from './heuristic';
import { createIsmctsAgent } from './ismcts';

/**
 * Self-play harness, in the spirit of ludometer: agent strength is measured by
 * playing games and fitting ratings, never asserted from inspection.
 *
 * Six-player Skip-Bo Golf has no natural head-to-head result, so each game is
 * decomposed into its fifteen pairwise finishes and an Elo rating is fitted to
 * those by repeated passes over the record.
 */

/** Node globals, declared locally because the project deliberately omits @types/node. */
declare const process:
  | { argv?: string[]; env?: Record<string, string | undefined> }
  | undefined;

export interface GameResult {
  seed: number;
  /** Agent name in each seat, in seat order. */
  seats: string[];
  /** Final score per seat. Lower is better. */
  scores: number[];
}

export interface AgentSummary {
  name: string;
  games: number;
  meanScore: number;
  /** Standard error of the mean score, so a difference can be judged. */
  scoreStdErr: number;
  /** Share of games finished with the lowest score; ties split the win. */
  winRate: number;
  elo: number;
  /** Half-width of a bootstrap interval on the Elo estimate. */
  eloError: number;
}

/** Guard against a pathological loop; a real round takes a few hundred actions. */
const MAX_ACTIONS_PER_GAME = 20000;

/**
 * Plays one complete round. `seats[i]` acts for player `i`, and every action is
 * checked against the engine before it is applied.
 */
export async function playGame(
  seats: readonly Agent[],
  seed: number,
  opts: { budgetMs?: number } = {},
): Promise<number[]> {
  let state: GameState = createInitialState(seed, seats.length);
  let actions = 0;
  while (!isTerminal(state)) {
    if (actions++ > MAX_ACTIONS_PER_GAME) throw new Error('game failed to terminate');
    const agent = seats[state.current];
    const action = await agent.chooseAction(state, state.current, { budgetMs: opts.budgetMs });
    state = applyAction(state, action);
  }
  return returns(state);
}

/** Rotates seating so no agent keeps the first-player advantage. */
function seatOrder(agents: readonly Agent[], game: number): Agent[] {
  const n = agents.length;
  return Array.from({ length: n }, (_, i) => agents[(i + game) % n]);
}

/**
 * Fits Elo ratings to the pairwise finishes in `results`. K is annealed across
 * passes so the ratings settle rather than oscillate, and the final ratings are
 * recentred on 1500.
 */
export function computeElo(results: readonly GameResult[], passes = 60): Map<string, number> {
  const rating = new Map<string, number>();
  for (const result of results) for (const name of result.seats) rating.set(name, 1500);

  let k = 24;
  for (let pass = 0; pass < passes; pass++) {
    for (const result of results) {
      for (let i = 0; i < result.seats.length; i++) {
        for (let j = i + 1; j < result.seats.length; j++) {
          const a = result.seats[i];
          const b = result.seats[j];
          if (a === b) continue; // a mirror pairing carries no information
          const ra = rating.get(a) as number;
          const rb = rating.get(b) as number;
          const outcome =
            result.scores[i] < result.scores[j] ? 1 : result.scores[i] > result.scores[j] ? 0 : 0.5;
          const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
          const delta = k * (outcome - expected);
          rating.set(a, ra + delta);
          rating.set(b, rb - delta);
        }
      }
    }
    k *= 0.96;
  }

  let mean = 0;
  for (const value of rating.values()) mean += value;
  mean /= Math.max(1, rating.size);
  for (const [name, value] of rating) rating.set(name, value - mean + 1500);
  return rating;
}

/** Bootstrap over whole games, giving a rough interval on each Elo estimate. */
function bootstrapEloError(results: readonly GameResult[], samples = 40): Map<string, number> {
  const rng = makeRng(0xbeef);
  const collected = new Map<string, number[]>();
  for (let s = 0; s < samples; s++) {
    const resample: GameResult[] = [];
    for (let i = 0; i < results.length; i++) {
      resample.push(results[Math.floor(rng.next() * results.length)]);
    }
    for (const [name, elo] of computeElo(resample, 30)) {
      const list = collected.get(name) ?? [];
      list.push(elo);
      collected.set(name, list);
    }
  }
  const errors = new Map<string, number>();
  for (const [name, values] of collected) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1);
    errors.set(name, Math.sqrt(variance));
  }
  return errors;
}

export interface ArenaReport {
  games: number;
  results: GameResult[];
  summaries: AgentSummary[];
}

/**
 * Runs `games` rounds with the given agents, rotating seats each round, and
 * summarises the outcome.
 */
export async function runArena(
  agents: readonly Agent[],
  options: { games?: number; seed?: number; budgetMs?: number; onGame?: (i: number) => void } = {},
): Promise<ArenaReport> {
  const games = options.games ?? 100;
  const baseSeed = options.seed ?? 1;
  const results: GameResult[] = [];

  for (let g = 0; g < games; g++) {
    const seats = seatOrder(agents, g);
    const seed = baseSeed + g * 104729;
    const scores = await playGame(seats, seed, { budgetMs: options.budgetMs });
    results.push({ seed, seats: seats.map((a) => a.name), scores });
    options.onGame?.(g + 1);
  }

  const elo = computeElo(results);
  const errors = bootstrapEloError(results);

  const totals = new Map<string, { n: number; sum: number; sumSq: number; wins: number }>();
  for (const result of results) {
    const best = Math.min(...result.scores);
    const winners = result.scores.filter((s) => s === best).length;
    for (let i = 0; i < result.seats.length; i++) {
      const name = result.seats[i];
      const entry = totals.get(name) ?? { n: 0, sum: 0, sumSq: 0, wins: 0 };
      entry.n += 1;
      entry.sum += result.scores[i];
      entry.sumSq += result.scores[i] ** 2;
      if (result.scores[i] === best) entry.wins += 1 / winners;
      totals.set(name, entry);
    }
  }

  const summaries: AgentSummary[] = [...totals.entries()]
    .map(([name, t]) => {
      const meanScore = t.sum / t.n;
      const variance = Math.max(0, t.sumSq / t.n - meanScore ** 2);
      return {
        name,
        games: t.n,
        meanScore,
        scoreStdErr: Math.sqrt(variance / t.n),
        winRate: t.wins / t.n,
        elo: elo.get(name) ?? 1500,
        eloError: errors.get(name) ?? 0,
      };
    })
    .sort((a, b) => b.elo - a.elo);

  return { games, results, summaries };
}

/** Renders the report as a fixed-width table. */
export function formatTable(report: ArenaReport): string {
  const header = ['agent', 'games', 'elo', '+/-', 'mean score', 'stderr', 'win rate'];
  const rows = report.summaries.map((s) => [
    s.name,
    String(s.games),
    s.elo.toFixed(0),
    s.eloError.toFixed(0),
    s.meanScore.toFixed(2),
    s.scoreStdErr.toFixed(2),
    `${(s.winRate * 100).toFixed(1)}%`,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [
    `${report.games} games, ${report.summaries.length} agents`,
    line(header),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

/** The default ladder: search, greedy evaluation, and uniform random as the floor. */
export function defaultLadder(budgetMs: number): Agent[] {
  const ismcts = createIsmctsAgent({ name: 'ismcts', budgetMs, seed: 7 });
  const heuristic = createHeuristicAgent();
  const random = createRandomAgent(99);
  // Six seats from three agents: two of each, so every pairing occurs often.
  return [ismcts, heuristic, random, ismcts, heuristic, random].slice(0, NUM_PLAYERS);
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const games = Number(env.ARENA_GAMES ?? 200);
  const budgetMs = Number(env.ARENA_BUDGET_MS ?? 250);
  const started = Date.now();

  // eslint-disable-next-line no-console
  console.log(`running ${games} games at ${budgetMs}ms per ISMCTS decision...`);
  const report = await runArena(defaultLadder(budgetMs), {
    games,
    seed: 20260828,
    onGame: (i) => {
      if (i % 10 === 0) console.log(`  ${i}/${games} games`);
    },
  });
  console.log(formatTable(report));
  console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * Only run the ladder when this file is the script being executed. vite-node
 * hides the entry path from `process.argv`, so `npm run arena` passes an
 * explicit `--arena` flag; importing this module from a test or the UI never
 * starts a match.
 */
const argv = (typeof process !== 'undefined' && process?.argv) || [];
if (argv.includes('--arena')) void main();

import { describe, expect, it } from 'vitest';
import { NUM_PLAYERS } from '../engine/state';
import { createRandomAgent } from './agent';
import { computeElo, defaultLadder, formatTable, playGame, runArena, type GameResult } from './arena';
import { createHeuristicAgent } from './heuristic';
import { createIsmctsAgent } from './ismcts';

describe('computeElo', () => {
  it('ranks a consistently better agent above a consistently worse one', () => {
    const results: GameResult[] = [];
    for (let g = 0; g < 30; g++) {
      results.push({ seed: g, seats: ['strong', 'weak'], scores: [0, 10] });
    }
    const elo = computeElo(results);
    expect(elo.get('strong')).toBeGreaterThan(elo.get('weak') as number);
    // Ratings are recentred, so the pair straddles 1500.
    expect(((elo.get('strong') as number) + (elo.get('weak') as number)) / 2).toBeCloseTo(1500, 6);
  });

  it('leaves evenly matched agents level', () => {
    const results: GameResult[] = [];
    for (let g = 0; g < 20; g++) {
      results.push({ seed: g, seats: ['a', 'b'], scores: g % 2 === 0 ? [0, 10] : [10, 0] });
    }
    const elo = computeElo(results);
    // Updates are applied game by game, so a small residual survives the anneal.
    expect(Math.abs((elo.get('a') as number) - (elo.get('b') as number))).toBeLessThan(5);
  });
});

describe('playGame', () => {
  it('runs a six-player round to a score for every seat', async () => {
    const seats = Array.from({ length: NUM_PLAYERS }, (_, i) => createRandomAgent(i + 1));
    const scores = await playGame(seats, 4242);
    expect(scores).toHaveLength(NUM_PLAYERS);
    for (const score of scores) expect(Number.isFinite(score)).toBe(true);
  });
});

describe('formatTable', () => {
  it('renders one row per agent, best first', async () => {
    const report = await runArena(
      [createRandomAgent(1), createHeuristicAgent(), createRandomAgent(2)],
      { games: 3, seed: 5 },
    );
    const table = formatTable(report);
    expect(table).toContain('agent');
    expect(table).toContain('heuristic');
    expect(table).toContain('random');
    expect(table.split('\n')).toHaveLength(5); // title, header, rule, two agents
    expect(report.summaries[0].elo).toBeGreaterThanOrEqual(report.summaries[1].elo);
  });
});

describe('defaultLadder', () => {
  it('seats six agents drawn from the three rungs', () => {
    const ladder = defaultLadder(10);
    expect(ladder).toHaveLength(NUM_PLAYERS);
    expect(new Set(ladder.map((a) => a.name))).toEqual(new Set(['ismcts', 'heuristic', 'random']));
  });
});

describe('search beats random', () => {
  // Deliberately a modest claim on a small sample: a tiny search budget against
  // uniform random play should still win comfortably on mean score. The full
  // ladder lives in `npm run arena`, not in the test suite.
  it('gives ISMCTS a clearly lower mean score than random', async () => {
    const agents = [
      createIsmctsAgent({ budgetMs: 25, seed: 1 }),
      createRandomAgent(11),
      createIsmctsAgent({ budgetMs: 25, seed: 2 }),
      createRandomAgent(12),
      createIsmctsAgent({ budgetMs: 25, seed: 3 }),
      createRandomAgent(13),
    ];
    const report = await runArena(agents, { games: 4, seed: 31337 });

    const summary = Object.fromEntries(report.summaries.map((s) => [s.name, s]));
    expect(summary.ismcts.meanScore).toBeLessThan(summary.random.meanScore - 10);
    expect(summary.ismcts.elo).toBeGreaterThan(summary.random.elo);
  }, 30000);
});

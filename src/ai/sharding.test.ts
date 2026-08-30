import { describe, expect, it } from 'vitest';
import { gameSeed, playIndexedGame, summarise } from './arena';
import { createHeuristicAgent } from './heuristic';
import { createRandomAgent } from './agent';

/**
 * A deterministic ladder. The searching agents stop on the wall clock, so they
 * are not reproducible run to run; these are, which is what lets sharding be
 * checked exactly rather than approximately.
 */
const ladder = () => [
  createHeuristicAgent('h1'),
  createRandomAgent(1),
  createHeuristicAgent('h2'),
  createRandomAgent(2),
  createHeuristicAgent('h3'),
  createRandomAgent(3),
];

describe('game indexing', () => {
  it('derives a seed from the index alone', () => {
    expect(gameSeed(1000, 0)).toBe(1000);
    expect(gameSeed(1000, 1)).toBe(1000 + 104729);
    expect(gameSeed(1000, 7)).toBe(1000 + 7 * 104729);
  });

  it('gives each index a distinct seed', () => {
    const seeds = new Set(Array.from({ length: 200 }, (_, g) => gameSeed(5, g)));
    expect(seeds.size).toBe(200);
  });
});

describe('sharding', () => {
  it('produces exactly the games a serial run would, in any split', async () => {
    const opts = { seed: 4242, seatCount: 6 };
    const serial = [];
    for (let g = 0; g < 6; g++) serial.push(await playIndexedGame(ladder(), g, opts));

    // Two shards, played out of order, then merged.
    const shardB = [];
    for (let g = 3; g < 6; g++) shardB.push(await playIndexedGame(ladder(), g, opts));
    const shardA = [];
    for (let g = 0; g < 3; g++) shardA.push(await playIndexedGame(ladder(), g, opts));

    expect([...shardA, ...shardB]).toEqual(serial);
  });

  it('rates a merged set the same as the serial set', async () => {
    const opts = { seed: 99, seatCount: 6 };
    const games = [];
    for (let g = 0; g < 8; g++) games.push(await playIndexedGame(ladder(), g, opts));

    const whole = summarise(games);
    const merged = summarise([...games.slice(4), ...games.slice(0, 4)]);

    // Ratings are fitted over the pooled record, so order of merge is irrelevant.
    const asMap = (r: typeof whole) =>
      Object.fromEntries(r.summaries.map((s) => [s.name, Math.round(s.elo)]));
    expect(asMap(merged)).toEqual(asMap(whole));
  });

  it('a game at one index does not depend on any other index being played', async () => {
    const opts = { seed: 7, seatCount: 6 };
    const alone = await playIndexedGame(ladder(), 5, opts);
    const after = [];
    for (let g = 0; g <= 5; g++) after.push(await playIndexedGame(ladder(), g, opts));
    expect(after[5]).toEqual(alone);
  });
});

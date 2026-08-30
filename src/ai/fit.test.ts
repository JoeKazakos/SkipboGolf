import { describe, expect, it } from 'vitest';
import { createHeuristicAgent, DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH, expectedScore } from './heuristic';
import { collectSamples, fitParameters, meanSquaredError } from './fit';
import type { Rank } from '../engine/cards';

describe('collectSamples', () => {
  it('pairs each sampled grid with that player\'s real final score', async () => {
    const samples = await collectSamples(createHeuristicAgent(), { games: 2, seed: 5 });
    expect(samples.length).toBeGreaterThan(50);
    for (const s of samples) {
      expect(s.view).toHaveLength(10);
      expect(Number.isFinite(s.finalScore)).toBe(true);
    }
  });

  it('samples every player, not only whoever is to move', async () => {
    // Six players each sampled once per turn means samples divide evenly.
    const samples = await collectSamples(createHeuristicAgent(), { games: 1, seed: 9 });
    expect(samples.length % 6).toBe(0);
  });
});

describe('fitParameters', () => {
  it('finds parameters that predict better than the hand-set ones', async () => {
    const samples = await collectSamples(createHeuristicAgent(), { games: 8, seed: 21 });
    const fit = fitParameters(samples);
    expect(fit.mse).toBeLessThan(fit.baselineMse);
    expect(fit.improvement).toBeGreaterThan(0);
  }, 60000);

  it('does not settle on a boundary of the search range', async () => {
    const samples = await collectSamples(createHeuristicAgent(), { games: 6, seed: 33 });
    const fit = fitParameters(samples);
    // A value pinned at 0 or at the ceiling would mean the range truncated it.
    expect(fit.hiddenEv).toBeGreaterThan(0);
    expect(fit.pMatch).toBeGreaterThan(0);
    expect(fit.pMatch).toBeLessThan(0.95);
  }, 60000);
});

describe('meanSquaredError', () => {
  it('is zero for a perfectly predicted set', () => {
    const view = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as (Rank | null)[];
    const exact = expectedScore(view, DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH);
    expect(meanSquaredError([{ view, finalScore: exact }], DEFAULT_HIDDEN_EV, DEFAULT_P_MATCH)).toBeCloseTo(0);
  });

  it('is zero for an empty set rather than NaN', () => {
    expect(meanSquaredError([], 4, 0.1)).toBe(0);
  });
});

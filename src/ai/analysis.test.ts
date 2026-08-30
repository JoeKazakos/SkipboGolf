import { describe, expect, it } from 'vitest';
import { analysePosition } from './analysis';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import { actionKey } from './ismcts';
import type { GameState } from '../engine/types';

/** A mid-round position with several legal choices. */
function position(): GameState {
  let s = createInitialState(31337);
  for (let i = 0; i < 25; i++) {
    const a = legalActions(s);
    s = applyAction(s, a[i % a.length]);
  }
  return s;
}

describe('analysePosition', () => {
  it('returns a candidate for every legal action', () => {
    const s = position();
    const a = analysePosition(s, s.current, { maxIterations: 300, budgetMs: 60000 });
    const legalKeys = new Set(legalActions(s).map(actionKey));
    const gotKeys = new Set(a.candidates.map((c) => actionKey(c.action)));
    expect(gotKeys).toEqual(legalKeys);
  });

  it('rebuilds real actions, not empty results', () => {
    // Guards the key format: a mismatch would silently yield no candidates.
    const s = position();
    const a = analysePosition(s, s.current, { maxIterations: 200, budgetMs: 60000 });
    expect(a.candidates.length).toBeGreaterThan(1);
    for (const c of a.candidates) {
      expect(legalActions(s).some((l) => actionKey(l) === actionKey(c.action))).toBe(true);
    }
  });

  it('orders candidates by visits, most-searched first', () => {
    const s = position();
    const a = analysePosition(s, s.current, { maxIterations: 400, budgetMs: 60000 });
    const visits = a.candidates.map((c) => c.visits);
    expect(visits).toEqual([...visits].sort((x, y) => y - x));
  });

  it('marks exactly one candidate as best', () => {
    const s = position();
    const a = analysePosition(s, s.current, { maxIterations: 300, budgetMs: 60000 });
    expect(a.candidates.filter((c) => c.best)).toHaveLength(1);
  });

  it('shares sum to one', () => {
    const s = position();
    const a = analysePosition(s, s.current, { maxIterations: 300, budgetMs: 60000 });
    const total = a.candidates.reduce((n, c) => n + c.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('reports a forced move without searching', () => {
    // After drawing, discarding is always legal; find a spot with one option.
    let s = createInitialState(5);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    // Place into every spot until only the discard remains legal.
    let guard = 0;
    while (legalActions(s).length > 1 && guard++ < 12) {
      const place = legalActions(s).find((a) => a.type === 'place');
      if (!place) break;
      s = applyAction(s, place);
    }
    if (legalActions(s).length === 1) {
      const a = analysePosition(s, s.current);
      expect(a.forced).toBe(true);
      expect(a.iterations).toBe(0);
      expect(a.candidates).toHaveLength(1);
    }
  });
});

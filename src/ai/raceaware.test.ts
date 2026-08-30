import { describe, expect, it } from 'vitest';
import { evaluateGrid, heuristicAction, raceFaceUpWeight } from './heuristic';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { GameState } from '../engine/types';
import type { Rank } from '../engine/cards';

/** Flips `n` of player `p`'s cards face up. */
function reveal(s: GameState, p: number, n: number): GameState {
  const next: GameState = JSON.parse(JSON.stringify(s));
  for (let i = 0; i < next.players[p].grid.length; i++) {
    next.players[p].grid[i].faceUp = i < n;
  }
  return next;
}

describe('raceFaceUpWeight', () => {
  it('is the base weight when no opponent has shown anything', () => {
    let s = createInitialState(11);
    for (let p = 1; p < s.players.length; p++) s = reveal(s, p, 0);
    const base = raceFaceUpWeight(s);

    let pressed = s;
    for (let p = 1; p < pressed.players.length; p++) pressed = reveal(pressed, p, 9);
    expect(raceFaceUpWeight(pressed)).toBeGreaterThan(base);
  });

  it('rises with the closest opponent, not the average', () => {
    let s = createInitialState(11);
    for (let p = 1; p < s.players.length; p++) s = reveal(s, p, 1);
    const oneAhead = reveal(s, 2, 9);
    // Everyone else is still at one card; the weight must follow the leader.
    expect(raceFaceUpWeight(oneAhead)).toBeGreaterThan(raceFaceUpWeight(s));
  });

  it('ignores the acting player, who cannot race themselves', () => {
    let s = createInitialState(11);
    for (let p = 1; p < s.players.length; p++) s = reveal(s, p, 0);
    const before = raceFaceUpWeight(s);
    expect(raceFaceUpWeight(reveal(s, s.current, 10))).toBe(before);
  });

  it('grows faster than linearly, so late pressure bites hardest', () => {
    let s = createInitialState(11);
    for (let p = 1; p < s.players.length; p++) s = reveal(s, p, 0);
    const w = (n: number) => raceFaceUpWeight(reveal(s, 1, n));
    const earlyStep = w(4) - w(2);
    const lateStep = w(10) - w(8);
    expect(lateStep).toBeGreaterThan(earlyStep);
  });
});

describe('evaluateGrid with a face-up weight', () => {
  it('values a revealed grid more highly as the weight rises', () => {
    const view = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as (Rank | null)[];
    expect(evaluateGrid(view, 2)).toBeLessThan(evaluateGrid(view, 0.4));
  });

  it('leaves an all-hidden grid untouched by the weight', () => {
    const view = new Array(10).fill(null) as (Rank | null)[];
    expect(evaluateGrid(view, 2)).toBe(evaluateGrid(view, 0.4));
  });
});

describe('race-aware play', () => {
  it('still returns a legal action', () => {
    let s = createInitialState(77);
    for (let i = 0; i < 20; i++) {
      const a = legalActions(s);
      s = applyAction(s, a[i % a.length]);
    }
    const action = heuristicAction(s, true);
    expect(legalActions(s)).toContainEqual(action);
  });

  it('can differ from the plain heuristic under pressure', () => {
    // Not asserting it always differs: the point is that the flag is wired in
    // and reaches the decision, which a difference in at least one position of
    // several proves.
    let differed = false;
    for (let seed = 1; seed <= 40 && !differed; seed++) {
      let s = createInitialState(seed);
      for (let i = 0; i < 15; i++) {
        const a = legalActions(s);
        s = applyAction(s, a[i % a.length]);
      }
      const pressed = reveal(s, s.current === 0 ? 1 : 0, 9);
      if (JSON.stringify(heuristicAction(pressed, true)) !== JSON.stringify(heuristicAction(pressed, false))) {
        differed = true;
      }
    }
    expect(differed).toBe(true);
  });
});

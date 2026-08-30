import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, isTerminal, legalActions, returns } from './state';
import { DECK_SIZE, GRID_SIZE } from './cards';
import { createHeuristicAgent } from '../ai/heuristic';

/**
 * The rules describe a six-player game, but nothing in the engine depends on
 * that number: seating, the final-turn cycle and scoring are all written
 * against players.length. These tests hold that open, so a table of any
 * supported size keeps working.
 */
describe('variable player count', () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    it(`deals a consistent table for ${n} players`, () => {
      const s = createInitialState(4242 + n, n);
      expect(s.players).toHaveLength(n);
      for (const p of s.players) expect(p.grid).toHaveLength(GRID_SIZE);
      // Every card is accounted for: grids, the center card and the draw pile.
      const dealt = n * GRID_SIZE + (s.centerCard ? 1 : 0) + s.drawPile.length;
      expect(dealt).toBe(DECK_SIZE);
    });

    it(`plays a full round to a scored finish with ${n} players`, async () => {
      let s = createInitialState(1234 + n, n);
      const agent = createHeuristicAgent();
      let guard = 0;
      while (!isTerminal(s)) {
        if (guard++ > 20000) throw new Error('round failed to terminate');
        const a = await agent.chooseAction(s, s.current);
        expect(legalActions(s)).toContainEqual(a);
        s = applyAction(s, a);
      }
      const scores = returns(s);
      expect(scores).toHaveLength(n);
      for (const score of scores) expect(Number.isFinite(score)).toBe(true);
      // Exactly one player triggers the end, and everyone else gets a last turn.
      expect(s.triggerPlayer).not.toBeNull();
    });
  }
});

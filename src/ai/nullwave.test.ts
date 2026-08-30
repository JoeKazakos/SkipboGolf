import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, isTerminal, legalActions } from '../engine/state';
import { createIsmctsAgent } from './ismcts';
import { createHeuristicAgent } from './heuristic';
import type { GameState } from '../engine/types';

/**
 * A wave that cannot change anything: the target spot already shows the held
 * rank face up, so the grid after the placement is identical to before and the
 * player still holds that rank. All it does is lock a spot.
 */
function isNullWave(s: GameState, spot: number): boolean {
  if (s.held == null) return false;
  const slot = s.players[s.current].grid[spot];
  return slot.faceUp && slot.card.rank === s.held.rank;
}

describe('null waves', () => {
  it('are never offered as a legal action', () => {
    let found = false;
    for (let seed = 1; seed < 200 && !found; seed++) {
      let s = createInitialState(seed);
      let guard = 0;
      while (!isTerminal(s) && guard < 600) {
        for (const a of legalActions(s)) {
          if (a.type === 'place' && isNullWave(s, a.spot)) {
            found = true;
            break;
          }
        }
        if (found) break;
        const acts = legalActions(s);
        s = applyAction(s, acts[guard % acts.length]);
        guard++;
      }
    }
    expect(found).toBe(false);
  });

  it('are therefore never chosen by any agent', async () => {
    const agents = [
      ['heuristic', createHeuristicAgent()],
      ['ismcts', createIsmctsAgent({ maxIterations: 120, budgetMs: 60000, seed: 3 })],
    ] as const;

    for (const [name, agent] of agents) {
      let chosen = 0;
      let offered = 0;
      for (let seed = 1; seed <= 6; seed++) {
        let s = createInitialState(seed);
        let guard = 0;
        while (!isTerminal(s) && guard < 900) {
          const acts = legalActions(s);
          const nulls = acts.filter((a) => a.type === 'place' && isNullWave(s, a.spot));
          if (nulls.length > 0) offered += 1;
          const pick = await agent.chooseAction(s, s.current);
          if (pick.type === 'place' && isNullWave(s, pick.spot)) chosen += 1;
          s = applyAction(s, pick);
          guard++;
        }
      }
      // eslint-disable-next-line no-console
      console.log(`${name}: offered a null wave in ${offered} positions, chose one ${chosen} times`);
      // Neither offered nor chosen, now that they are not legal actions.
      expect(offered).toBe(0);
      expect(chosen).toBe(0);
    }
  }, 120000);
});

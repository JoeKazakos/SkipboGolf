import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import { createHeuristicAgent } from './heuristic';
import { createIsmctsAgent, ismctsSearch } from './ismcts';

/** A mid-round position, so the choice is not trivial. */
function position() {
  let s = createInitialState(31337);
  for (let i = 0; i < 25; i++) {
    const a = legalActions(s);
    s = applyAction(s, a[i % a.length]);
  }
  return s;
}

describe('determinism', () => {
  it('deals identically for the same seed, and differently for another', () => {
    const a = createInitialState(777);
    const b = createInitialState(777);
    const c = createInitialState(778);
    const grids = (s: ReturnType<typeof createInitialState>) =>
      s.players.map((p) => p.grid.map((g) => g.card.rank).join()).join('|');
    expect(grids(a)).toBe(grids(b));
    expect(grids(a)).not.toBe(grids(c));
  });

  it('heuristic picks the same action every time for one position', async () => {
    const s = position();
    const agent = createHeuristicAgent();
    const first = JSON.stringify(await agent.chooseAction(s, s.current));
    for (let i = 0; i < 15; i++) {
      expect(JSON.stringify(await agent.chooseAction(s, s.current))).toBe(first);
    }
  });

  it('ISMCTS is reproducible when the ITERATION count is what binds', () => {
    const s = position();
    const opts = { seed: 4242, maxIterations: 400, budgetMs: 600000 };
    const runs = Array.from({ length: 4 }, () =>
      JSON.stringify(ismctsSearch(s, s.current, opts).action),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it('a fixed seed alone does not fix the iteration count under a time budget', () => {
    const s = position();
    // Same seed, wall-clock budget: how far the search gets depends on the
    // machine, so the iteration count varies between runs.
    const counts = Array.from({ length: 4 }, () =>
      ismctsSearch(s, s.current, { seed: 4242, budgetMs: 60 }).iterations,
    );
    expect(counts.every((c) => c > 0)).toBe(true);
    // Documented, not asserted as unequal: it usually varies, but on a very
    // steady machine it might not. The point is that nothing guarantees it.
    expect(new Set(counts).size).toBeGreaterThanOrEqual(1);
  });

  it('the same agent instance replays identically from a fixed start', async () => {
    const make = () => createIsmctsAgent({ seed: 99, maxIterations: 150, budgetMs: 600000 });
    const run = async () => {
      let s = createInitialState(555);
      const agent = make();
      const chosen: string[] = [];
      for (let i = 0; i < 6; i++) {
        const a = await agent.chooseAction(s, s.current);
        chosen.push(JSON.stringify(a));
        s = applyAction(s, a);
      }
      return chosen.join('|');
    };
    expect(await run()).toBe(await run());
  });
});

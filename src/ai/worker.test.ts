import { describe, expect, it } from 'vitest';
import { makeRng } from '../engine/rng';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { GameState } from '../engine/types';
import { createWorkerAgent, handleRequest } from './worker';

/** Advances a game with random legal play, to get varied decision points. */
function advance(seed: number, steps: number): GameState {
  const rng = makeRng(seed);
  let s = createInitialState(seed);
  for (let i = 0; i < steps && !s.terminal; i++) {
    const legal = legalActions(s);
    s = applyAction(s, legal[Math.floor(rng.next() * legal.length)]);
  }
  return s;
}

describe('handleRequest', () => {
  it('answers with a legal action', () => {
    const state = advance(64, 40);
    const response = handleRequest({
      id: 1,
      type: 'choose',
      state,
      player: state.current,
      options: { budgetMs: 20, seed: 1 },
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.id).toBe(1);
    expect(legalActions(state)).toContainEqual(response.action);
  });

  it('reports a failure rather than throwing', () => {
    // A terminal state has no legal actions at all.
    const state: GameState = { ...createInitialState(2), terminal: true };
    const response = handleRequest({
      id: 7,
      type: 'choose',
      state,
      player: 0,
      options: { budgetMs: 5 },
    });
    expect(response).toEqual({ id: 7, ok: false, error: 'no legal actions available' });
  });
});

describe('createWorkerAgent', () => {
  it('degrades to an in-thread search where no Worker can be built', async () => {
    // jsdom provides no Worker constructor, which is exactly the fallback path
    // that also covers Node and any bundler that missed the `new URL` form.
    expect(typeof Worker).toBe('undefined');

    const agent = createWorkerAgent({ budgetMs: 10, seed: 6 });
    expect(agent.name).toBe('ismcts-worker');

    for (const steps of [0, 25, 70]) {
      const state = advance(steps + 11, steps);
      if (state.terminal) continue;
      const action = await agent.chooseAction(state, state.current);
      expect(legalActions(state)).toContainEqual(action);
    }
  });

  it('plays a whole turn through the agent interface', async () => {
    const agent = createWorkerAgent({ budgetMs: 8, seed: 2, useWorker: false });
    let s = createInitialState(303);
    const turn = s.turnCount;
    let steps = 0;
    while (s.turnCount === turn && steps < 30) {
      const action = await agent.chooseAction(s, s.current);
      expect(legalActions(s)).toContainEqual(action);
      s = applyAction(s, action);
      steps += 1;
    }
    // Every turn ends with exactly one discard (section 15.5).
    expect(s.turnCount).toBe(turn + 1);
  });
});

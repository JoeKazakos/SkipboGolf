import { describe, expect, it } from 'vitest';
import { createInitialState, legalActions } from '../engine/state';
import { createHeuristicAgent } from './heuristic';
import {
  createAgentForProfile,
  createBlunderingAgent,
  DEFAULT_PRESET_ID,
  DEFAULT_PROFILE_ID,
  PRESETS,
  presetById,
  profileById,
  ROSTER,
} from './roster';

describe('roster', () => {
  it('has unique ids', () => {
    const ids = ROSTER.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes a default profile that exists', () => {
    expect(profileById(DEFAULT_PROFILE_ID).id).toBe(DEFAULT_PROFILE_ID);
  });

  it('throws on an unknown profile rather than silently substituting one', () => {
    expect(() => profileById('nobody')).toThrow(/unknown opponent profile/);
  });

  it('orders the ismcts tiers by increasing search budget', () => {
    const budgets = ROSTER.filter((p) => p.kind === 'ismcts').map((p) => p.budgetMs ?? 0);
    const sorted = [...budgets].sort((a, b) => a - b);
    expect(budgets).toEqual(sorted);
  });

  it('never carries an elo without an error bar, or vice versa', () => {
    for (const p of ROSTER) {
      expect(p.elo === null).toBe(p.eloError === null);
    }
  });

  it('is listed weakest-first, matching the measured ratings', () => {
    // The roster order is what the setup screen presents as a difficulty
    // ladder, so it must not drift away from what self-play actually measured.
    const rated = ROSTER.filter((p) => p.elo != null).map((p) => p.elo as number);
    const sorted = [...rated].sort((a, b) => a - b);
    expect(rated).toEqual(sorted);
  });

  it('builds a working agent for every profile', async () => {
    const state = createInitialState(20260829);
    for (const profile of ROSTER) {
      // Keep the test quick: the real budgets are exercised by the arena.
      const agent = createAgentForProfile({ ...profile, budgetMs: 10 }, 5);
      const action = await agent.chooseAction(state, state.current);
      expect(legalActions(state)).toContainEqual(action);
    }
  });
});

describe('presets', () => {
  it('seat exactly five opponents drawn from the roster', () => {
    const ids = new Set(ROSTER.map((p) => p.id));
    for (const preset of PRESETS) {
      expect(preset.seats).toHaveLength(5);
      for (const seat of preset.seats) expect(ids.has(seat)).toBe(true);
    }
  });

  it('exposes a default preset that exists', () => {
    expect(presetById(DEFAULT_PRESET_ID).id).toBe(DEFAULT_PRESET_ID);
  });

  it('gets stronger from one preset to the next', () => {
    // Rank profiles by their position in the roster, which is weakest-first.
    const rank = new Map(ROSTER.map((p, i) => [p.id, i]));
    const strength = PRESETS.map(
      (p) => p.seats.reduce((sum, id) => sum + (rank.get(id) ?? 0), 0) / p.seats.length,
    );
    const sorted = [...strength].sort((a, b) => a - b);
    expect(strength).toEqual(sorted);
  });
});

describe('createBlunderingAgent', () => {
  it('always returns a legal action', async () => {
    const state = createInitialState(99);
    const agent = createBlunderingAgent(createHeuristicAgent(), 0.5, 1);
    for (let i = 0; i < 20; i++) {
      const action = await agent.chooseAction(state, state.current);
      expect(legalActions(state)).toContainEqual(action);
    }
  });

  it('deviates from its base agent some of the time, but not always', async () => {
    const state = createInitialState(1234);
    const base = createHeuristicAgent();
    const noisy = createBlunderingAgent(createHeuristicAgent(), 0.5, 7);
    const baseline = JSON.stringify(await base.chooseAction(state, state.current));

    let same = 0;
    const trials = 60;
    for (let i = 0; i < trials; i++) {
      const got = JSON.stringify(await noisy.chooseAction(state, state.current));
      if (got === baseline) same++;
    }
    // With epsilon 0.5 it should agree often but not every time. Loose bounds:
    // this asserts the wrapper is actually wired in, not a precise rate.
    expect(same).toBeGreaterThan(trials * 0.2);
    expect(same).toBeLessThan(trials);
  });

  it('with epsilon 0 always matches its base agent', async () => {
    const state = createInitialState(555);
    const base = createHeuristicAgent();
    const wrapped = createBlunderingAgent(createHeuristicAgent(), 0, 3);
    for (let i = 0; i < 10; i++) {
      expect(await wrapped.chooseAction(state, state.current)).toEqual(
        await base.chooseAction(state, state.current),
      );
    }
  });
});

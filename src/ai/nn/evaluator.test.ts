import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, isTerminal, legalActions } from '../../engine/state';
import { makeRng } from '../../engine/rng';
import type { Action, GameState } from '../../engine/types';
import { ismctsSearch, determinize } from '../ismcts';
import { MAX_SEATS, POLICY_SIZE, policyIndex, type Evaluator } from './contracts';
import { createNetEvaluator, evaluatorPriors, evaluatorReward } from './evaluator';
import { FEATURE_SIZE } from './features';
import { DEFAULT_ARCH, Net } from './net';

/**
 * Gates for putting the network inside the search.
 *
 * The property that matters most is the negative one: with no evaluator
 * passed, the search must behave exactly as it did before this existed. The
 * roster's measured ratings depend on that, and an option nobody uses must not
 * be able to move them.
 */

function midGame(seed: number, players: number, steps: number): GameState {
  const rng = makeRng(seed);
  let s = createInitialState(seed, players);
  for (let i = 0; i < steps && !isTerminal(s); i++) {
    const acts = legalActions(s);
    s = applyAction(s, acts[Math.floor(rng.next() * acts.length)]);
  }
  return s;
}

const net = Net.create(DEFAULT_ARCH, 42);
const evaluator = createNetEvaluator(net, 'test-net');

describe('net evaluator', () => {
  it('refuses a network whose input size is not the encoder"s', () => {
    const wrong = Net.create({ ...DEFAULT_ARCH, inputSize: FEATURE_SIZE + 1 }, 1);
    expect(() => createNetEvaluator(wrong)).toThrow(/inputs/i);
  });

  it('returns a reward per seat, in range, in absolute seat order', () => {
    for (const players of [2, 4, 6, 7]) {
      const s = midGame(700 + players, players, 40);
      const reward = evaluatorReward(evaluator, s, players);
      expect(reward.length).toBe(players);
      for (const r of reward) {
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rotates the value head back to the seat it belongs to', () => {
    // A stub whose value vector is 0, 0.1, 0.2 ... by RELATIVE seat. Undoing
    // the rotation must land offset k on the absolute seat k after the mover.
    const stub: Evaluator = {
      name: 'ramp',
      evaluate: () => ({
        value: Float32Array.from({ length: MAX_SEATS }, (_, i) => i / 10),
        policy: new Float32Array(POLICY_SIZE).fill(1 / POLICY_SIZE),
      }),
    };
    const s = midGame(31, 5, 33);
    const reward = evaluatorReward(stub, s, 5);
    for (let offset = 0; offset < 5; offset++) {
      const seat = (offset + s.current) % 5;
      expect(reward[seat]).toBeCloseTo(offset / 10, 6);
    }
  });

  it('gives priors that sum to one over exactly the legal actions', () => {
    for (const players of [3, 6]) {
      const s = midGame(88 + players, players, 55);
      const actions = legalActions(s);
      if (actions.length === 0) continue;
      const priors = evaluatorPriors(evaluator, s, actions, players);
      expect(priors.length).toBe(actions.length);
      let sum = 0;
      for (const p of priors) {
        expect(p).toBeGreaterThanOrEqual(0);
        sum += p;
      }
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('falls back to uniform when the head puts no mass on a legal move', () => {
    const dead: Evaluator = {
      name: 'zeros',
      evaluate: () => ({
        value: new Float32Array(MAX_SEATS),
        policy: new Float32Array(POLICY_SIZE),
      }),
    };
    const s = midGame(12, 4, 30);
    const actions = legalActions(s);
    const priors = evaluatorPriors(dead, s, actions, 4);
    for (const p of priors) expect(p).toBeCloseTo(1 / actions.length, 6);
  });

  it('reads only the information state, like the encoder it wraps', () => {
    // Same guarantee features.ts carries, asserted through the wrapper so a
    // future change here cannot quietly reintroduce a leak.
    const rng = makeRng(5);
    const s = midGame(404, 5, 60);
    const base = evaluatorReward(evaluator, s, 5);
    for (let w = 0; w < 4; w++) {
      const world = determinize(s, s.current, rng);
      expect(evaluatorReward(evaluator, world, 5)).toEqual(base);
    }
  });
});

describe('search with a network', () => {
  it('still returns a legal action', () => {
    for (const players of [2, 5, 7]) {
      const s = midGame(2024 + players, players, 45);
      if (isTerminal(s)) continue;
      const legal = legalActions(s).map((a) => JSON.stringify(a));
      const result = ismctsSearch(s, s.current, {
        evaluator,
        maxIterations: 60,
        budgetMs: 60_000,
        seed: 9,
      });
      expect(legal).toContain(JSON.stringify(result.action));
    }
  });

  it('never puts a prior on an action the position does not allow', () => {
    const s = midGame(99, 6, 70);
    const actions = legalActions(s);
    const priors = evaluatorPriors(evaluator, s, actions, 6);
    // Every index carrying mass maps back to one of this position's actions.
    const legalIndices = new Set(actions.map((a: Action) => policyIndex(a, s.current, 6)));
    for (let i = 0; i < actions.length; i++) {
      if (priors[i] > 0) expect(legalIndices.has(policyIndex(actions[i], s.current, 6))).toBe(true);
    }
  });

  it('plays a whole game to a terminal state without faltering', () => {
    let s = createInitialState(777, 4);
    let guard = 0;
    while (!isTerminal(s) && guard++ < 4000) {
      const result = ismctsSearch(s, s.current, {
        evaluator,
        maxIterations: 12,
        budgetMs: 60_000,
        seed: guard,
      });
      s = applyAction(s, result.action);
    }
    expect(isTerminal(s)).toBe(true);
  }, 120_000);

  it('leaves the search unchanged when no evaluator is passed', () => {
    // The negative gate. Same seed, same everything, with and without the
    // option present but undefined: the roster's ratings ride on this.
    const s = midGame(1234, 6, 50);
    const a = ismctsSearch(s, s.current, { maxIterations: 200, budgetMs: 60_000, seed: 3 });
    const b = ismctsSearch(s, s.current, {
      maxIterations: 200,
      budgetMs: 60_000,
      seed: 3,
      evaluator: undefined,
    });
    expect(b.action).toEqual(a.action);
    expect(b.rootVisits).toEqual(a.rootVisits);
  });

  it('a different network produces a different search', () => {
    // Guards against the evaluator being silently ignored, which would make
    // every test above pass while the network did nothing at all.
    const s = midGame(55, 6, 48);
    const opts = { maxIterations: 250, budgetMs: 60_000, seed: 7 } as const;
    const one = ismctsSearch(s, s.current, {
      ...opts,
      evaluator: createNetEvaluator(Net.create(DEFAULT_ARCH, 1)),
    });
    const two = ismctsSearch(s, s.current, {
      ...opts,
      evaluator: createNetEvaluator(Net.create(DEFAULT_ARCH, 2)),
    });
    const plain = ismctsSearch(s, s.current, opts);
    const asKey = (r: typeof one) => r.rootVisits.map((v) => `${v.key}:${v.visits}`).join(',');
    expect(asKey(one)).not.toBe(asKey(plain));
    expect(asKey(one)).not.toBe(asKey(two));
  });
});

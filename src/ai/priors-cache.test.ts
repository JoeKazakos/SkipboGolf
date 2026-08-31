import { describe, expect, it } from 'vitest';
import { makeRng } from '../engine/rng';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { GameState } from '../engine/types';
import { policyPriors } from './heuristic';
import { actionKey, cachedPriors, determinize, ismctsSearch } from './ismcts';

/**
 * The prior cache lives on a tree node that is visited under many different
 * determinized worlds, and those worlds do not agree on what is legal: a wave
 * depends on the ranks of face-down cards. So the thing worth testing is not
 * that the cache is fast but that it stays correct when the action set changes
 * underneath it.
 */

/** Advances a game a given number of actions with random legal play. */
function advance(seed: number, steps: number): GameState {
  const rng = makeRng(seed);
  let s = createInitialState(seed);
  for (let i = 0; i < steps && !s.terminal; i++) {
    const legal = legalActions(s);
    s = applyAction(s, legal[Math.floor(rng.next() * legal.length)]);
  }
  return s;
}

interface World {
  state: GameState;
  /** Action keys taken from the root, so two worlds can be compared at the SAME tree node. */
  path: string;
  keys: string[];
}

/**
 * One determinized world, walked a fixed number of plies down the tree.
 *
 * The root itself is no use here: at the root the acting player's legal actions
 * are decided entirely by public information, so every world agrees. Legality
 * only starts to diverge once a placement has turned a card face up and
 * revealed a rank the worlds disagreed about, which is exactly the situation
 * the cache has to survive.
 *
 * The descent always takes the lowest action key, so the same path is followed
 * in every world in which that path exists.
 */
function walk(base: GameState, rng: ReturnType<typeof makeRng>, depth: number): World {
  let state = determinize(base, base.current, rng);
  const taken: string[] = [];
  for (let d = 0; d < depth && !state.terminal; d++) {
    const actions = legalActions(state);
    if (actions.length === 0) break;
    const keys = actions.map(actionKey);
    let pick = 0;
    for (let i = 1; i < keys.length; i++) if (keys[i] < keys[pick]) pick = i;
    taken.push(keys[pick]);
    state = applyAction(state, actions[pick]);
  }
  return { state, path: taken.join('>'), keys: legalActions(state).map(actionKey) };
}

/**
 * Two determinizations that reach the same tree node, chosen by `accept`.
 *
 * Which worlds exist is a property of the deal rather than something a test can
 * construct by hand, so this searches a fixed set of seeded positions for a pair
 * with the shape the test needs. Deterministic, and it fails loudly rather than
 * silently testing nothing.
 */
function findWorldPair(accept: (a: World, b: World) => boolean): [World, World] {
  const rng = makeRng(90210);
  for (const steps of [20, 35, 50, 65]) {
    const base = advance(steps + 7, steps);
    if (base.terminal) continue;
    for (const depth of [1, 2, 3]) {
      const sampled: World[] = [];
      for (let i = 0; i < 30; i++) sampled.push(walk(base, rng, depth));
      for (const a of sampled) {
        for (const b of sampled) {
          if (a.path === b.path && a.keys.length > 0 && b.keys.length > 0 && accept(a, b)) {
            return [a, b];
          }
        }
      }
    }
  }
  throw new Error('no determinization pair with the required shape was found');
}

const sameKeys = (a: World, b: World): boolean =>
  a.keys.length === b.keys.length && a.keys.every((k, i) => k === b.keys[i]);

describe('cachedPriors', () => {
  it('matches policyPriors exactly on the first world through a node', () => {
    const s = advance(31, 55);
    const world = determinize(s, s.current, makeRng(7));
    const actions = legalActions(world);
    const keys = actions.map(actionKey);
    const cache = new Map<string, number>();
    expect(cachedPriors(cache, world, actions, keys)).toEqual(policyPriors(world, actions));
    expect(cache.size).toBe(new Set(keys).size);
  });

  it('gives every action a correct prior when a second world makes different actions legal', () => {
    // The pair must genuinely disagree about legality, and must still overlap,
    // or the test would not exercise the merge at all.
    const [first, second] = findWorldPair(
      (a, b) =>
        !sameKeys(a, b) &&
        b.keys.some((k) => !a.keys.includes(k)) &&
        b.keys.some((k) => a.keys.includes(k)),
    );

    const cache = new Map<string, number>();
    const firstActions = legalActions(first.state);
    const firstPriors = cachedPriors(cache, first.state, firstActions, first.keys);

    const secondActions = legalActions(second.state);
    const secondPriors = cachedPriors(cache, second.state, secondActions, second.keys);
    const freshSecond = policyPriors(second.state, secondActions);

    expect(secondPriors).toHaveLength(second.keys.length);
    for (let i = 0; i < second.keys.length; i++) {
      const seenAt = first.keys.indexOf(second.keys[i]);
      // An action the first world also offered keeps the prior it was cached
      // with; one only this world offers is filled in from this world.
      expect(secondPriors[i]).toBe(seenAt >= 0 ? firstPriors[seenAt] : freshSecond[i]);
      expect(Number.isFinite(secondPriors[i])).toBe(true);
    }
    // Every key from both worlds is now known, so a later visit costs nothing.
    for (const key of [...first.keys, ...second.keys]) expect(cache.has(key)).toBe(true);
  });

  it('reuses the cached prior rather than recomputing it in the new world', () => {
    // Same actions, different hidden cards, so the heuristic would answer
    // differently if it were being asked again. It should not be.
    const [first, second] = findWorldPair((a, b) => {
      if (!sameKeys(a, b)) return false;
      const pa = policyPriors(a.state, legalActions(a.state));
      const pb = policyPriors(b.state, legalActions(b.state));
      return pa.some((v, i) => v !== pb[i]);
    });

    const cache = new Map<string, number>();
    const firstPriors = cachedPriors(cache, first.state, legalActions(first.state), first.keys);
    const secondPriors = cachedPriors(cache, second.state, legalActions(second.state), second.keys);
    expect(secondPriors).toEqual(firstPriors);
    expect(secondPriors).not.toEqual(policyPriors(second.state, legalActions(second.state)));
  });

  it('leaves the search picking a legal action', () => {
    const s = advance(404, 48);
    const result = ismctsSearch(s, s.current, { budgetMs: 60, seed: 5, maxIterations: 4000 });
    expect(legalActions(s).map(actionKey)).toContain(actionKey(result.action));
    expect(result.iterations).toBeGreaterThan(0);
  });
});

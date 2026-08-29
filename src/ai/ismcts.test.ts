import { describe, expect, it } from 'vitest';
import { DECK_SIZE } from '../engine/cards';
import { makeRng } from '../engine/rng';
import {
  NUM_PLAYERS,
  applyAction,
  createInitialState,
  knownCards,
  legalActions,
  observationFor,
} from '../engine/state';
import type { GameState } from '../engine/types';
import { createRandomAgent } from './agent';
import { actionKey, createIsmctsAgent, determinize, ismctsSearch, rewardVector } from './ismcts';

/** Every rank in the game, across every zone, as a count per rank. */
function rankCensus(s: GameState): number[] {
  const counts = new Array<number>(14).fill(0);
  for (const p of s.players) {
    for (const slot of p.grid) counts[slot.card.rank] += 1;
    for (const c of p.discard) counts[c.rank] += 1;
  }
  for (const c of s.drawPile) counts[c.rank] += 1;
  if (s.centerCard) counts[s.centerCard.rank] += 1;
  if (s.held) counts[s.held.rank] += 1;
  return counts;
}

/** Every card id in the game. Determinization reassigns ranks but never loses an id. */
function idCensus(s: GameState): number[] {
  const ids: number[] = [];
  for (const p of s.players) {
    for (const slot of p.grid) ids.push(slot.card.id);
    for (const c of p.discard) ids.push(c.id);
  }
  for (const c of s.drawPile) ids.push(c.id);
  if (s.centerCard) ids.push(s.centerCard.id);
  if (s.held) ids.push(s.held.id);
  return ids.sort((a, b) => a - b);
}

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

describe('determinize', () => {
  it('leaves the viewer observation completely unchanged', () => {
    const rng = makeRng(77);
    for (const steps of [0, 15, 60, 140]) {
      const s = advance(steps + 1, steps);
      if (s.terminal) continue;
      for (let viewer = 0; viewer < NUM_PLAYERS; viewer++) {
        const world = determinize(s, viewer, rng);
        expect(observationFor(world, viewer)).toEqual(observationFor(s, viewer));
      }
    }
  });

  it('keeps every card the viewer can actually see', () => {
    const rng = makeRng(5);
    const s = advance(42, 90);
    const world = determinize(s, 0, rng);
    const before = knownCards(s, 0)
      .map((c) => `${c.id}:${c.rank}`)
      .sort();
    const after = knownCards(world, 0)
      .map((c) => `${c.id}:${c.rank}`)
      .sort();
    expect(after).toEqual(before);
  });

  it('preserves the whole 162-card deck', () => {
    const rng = makeRng(9);
    const full = new Array<number>(14).fill(0);
    for (let rank = 1; rank <= 12; rank++) full[rank] = 12;
    full[13] = 18;

    for (const steps of [0, 30, 110]) {
      const s = advance(steps + 3, steps);
      if (s.terminal) continue;
      const world = determinize(s, 2, rng);
      expect(rankCensus(world)).toEqual(full);
      expect(rankCensus(world)).toEqual(rankCensus(s));
      expect(idCensus(world)).toEqual(idCensus(s));
      expect(idCensus(world)).toHaveLength(DECK_SIZE);
    }
  });

  it('actually redeals the hidden cards, rather than copying them', () => {
    const rng = makeRng(13);
    const s = createInitialState(21);
    const worlds = [determinize(s, 0, rng), determinize(s, 0, rng)];
    const faceDown = (w: GameState) =>
      w.players[0].grid.filter((slot) => !slot.faceUp).map((slot) => slot.card.rank);
    expect(faceDown(worlds[0])).not.toEqual(faceDown(worlds[1]));
  });
});

describe('rewardVector', () => {
  it('gives the lowest score the highest reward', () => {
    const rewards = rewardVector([0, 10, 20, 30, 40, 50]);
    for (let i = 1; i < rewards.length; i++) expect(rewards[i]).toBeLessThan(rewards[i - 1]);
    for (const r of rewards) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('rewards each player independently, since the game is not zero-sum', () => {
    // Everyone playing well is better for everyone than everyone playing badly.
    const good = rewardVector([0, 0, 0, 0, 0, 0]);
    const bad = rewardVector([40, 40, 40, 40, 40, 40]);
    expect(good[0]).toBeGreaterThan(bad[0]);
  });
});

describe('ismctsSearch', () => {
  it('returns an action that is legal in the real state', () => {
    const rng = makeRng(31);
    for (let trial = 0; trial < 12; trial++) {
      const s = advance(200 + trial, Math.floor(rng.next() * 150));
      if (s.terminal) continue;
      const legal = legalActions(s);
      const { action } = ismctsSearch(s, s.current, { budgetMs: 15, seed: trial + 1 });
      expect(legal.map(actionKey)).toContain(actionKey(action));
      expect(legal).toContainEqual(action);
    }
  });

  it('short-circuits when only one action is legal', () => {
    // At the deal every discard pile is empty, so removing the centre card
    // leaves the draw pile as the single legal source.
    const forced: GameState = { ...createInitialState(5), centerCard: null };
    expect(legalActions(forced)).toHaveLength(1);

    const result = ismctsSearch(forced, forced.current, { budgetMs: 60000 });
    expect(result.iterations).toBe(0);
    expect(result.action).toEqual({ type: 'draw', source: { kind: 'pile' } });
  });

  it('respects the iteration cap and the time budget', () => {
    const s = createInitialState(11);
    const capped = ismctsSearch(s, 0, { budgetMs: 60000, maxIterations: 25, seed: 2 });
    expect(capped.iterations).toBe(25);

    const started = Date.now();
    ismctsSearch(s, 0, { budgetMs: 120, seed: 2 });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('stops early when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const s = createInitialState(17);
    const result = ismctsSearch(s, 0, { budgetMs: 60000, signal: controller.signal });
    expect(result.iterations).toBe(0);
    expect(legalActions(s)).toContainEqual(result.action);
  });

  it('spends its visits on the actions it likes, not uniformly', () => {
    const s = createInitialState(88);
    const result = ismctsSearch(s, 0, { budgetMs: 400, seed: 4 });
    expect(result.iterations).toBeGreaterThan(10);
    const total = result.rootVisits.reduce((a, b) => a + b.visits, 0);
    expect(result.rootVisits[0].visits).toBeGreaterThan(total / result.rootVisits.length);
  });
});

describe('createIsmctsAgent', () => {
  it('plays a full six-player game to a finish without throwing', async () => {
    const agent = createIsmctsAgent({ budgetMs: 8, seed: 3 });
    const random = createRandomAgent(4);
    let s = createInitialState(909);
    let steps = 0;
    while (!s.terminal && steps < 3000) {
      const actor = s.current % 2 === 0 ? agent : random;
      const action = await actor.chooseAction(s, s.current);
      expect(legalActions(s)).toContainEqual(action);
      s = applyAction(s, action);
      steps += 1;
    }
    expect(s.terminal).toBe(true);
  });
});

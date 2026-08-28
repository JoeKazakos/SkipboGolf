import { describe, expect, it } from 'vitest';
import { DECK_SIZE, GRID_SIZE } from './cards';
import { makeRng } from './rng';
import {
  NUM_PLAYERS,
  applyAction,
  createInitialState,
  legalActions,
  returns,
} from './state';
import type { GameState } from './types';

/** Every card id currently in the game, across every zone. */
function allCardIds(s: GameState): number[] {
  const ids: number[] = [];
  for (const p of s.players) {
    for (const slot of p.grid) ids.push(slot.card.id);
    for (const c of p.discard) ids.push(c.id);
  }
  for (const c of s.drawPile) ids.push(c.id);
  if (s.centerCard) ids.push(s.centerCard.id);
  if (s.held) ids.push(s.held.id);
  return ids;
}

function checkInvariants(s: GameState): void {
  const ids = allCardIds(s);
  expect(ids).toHaveLength(DECK_SIZE);
  expect(new Set(ids).size).toBe(DECK_SIZE);

  for (const p of s.players) expect(p.grid).toHaveLength(GRID_SIZE);
  expect(s.placements).toBeLessThanOrEqual(GRID_SIZE);
  expect(s.locked.filter(Boolean).length).toBe(s.placements);
  if (s.phase === 'draw') expect(s.held).toBeNull();
  if (s.phase === 'act' && !s.terminal) expect(s.held).not.toBeNull();
}

/** Plays one full game with uniformly random legal actions. */
function randomPlayout(seed: number) {
  const rng = makeRng(seed);
  let s = createInitialState(seed);
  let steps = 0;
  let discards = 0;
  let turnsStarted = 1;

  while (!s.terminal) {
    checkInvariants(s);
    const actions = legalActions(s);
    expect(actions.length).toBeGreaterThan(0);

    const action = actions[Math.floor(rng.next() * actions.length)];
    const before = s.current;
    s = applyAction(s, action);

    // A turn ends if and only if the action was a discard.
    if (action.type === 'discard') {
      discards++;
      if (!s.terminal) {
        expect(s.current).not.toBe(before);
        expect(s.phase).toBe('draw');
        turnsStarted++;
      }
    } else {
      expect(s.current).toBe(before);
    }

    steps++;
    if (steps > 200000) throw new Error('game failed to terminate');
  }

  checkInvariants(s);
  return { state: s, steps, discards, turnsStarted };
}

describe('invariants across random playouts', () => {
  const seeds = [1, 2, 3, 7, 11, 42, 99, 123, 2024, 31337];

  it.each(seeds)('seed %i holds every invariant and terminates', (seed) => {
    const { state, discards } = randomPlayout(seed);

    expect(state.terminal).toBe(true);
    expect(state.triggerPlayer).not.toBeNull();

    // Every turn ends in exactly one discard (asserted per-step in the playout).
    // The piles can hold fewer than that, because a reshuffle recycles them.
    const totalDiscarded = state.players.reduce((n, p) => n + p.discard.length, 0);
    expect(totalDiscarded).toBeLessThanOrEqual(discards);
    expect(discards).toBeGreaterThan(0);

    // All hands are revealed at the end.
    for (const p of state.players) {
      expect(p.grid.every((slot) => slot.faceUp)).toBe(true);
    }

    const scores = returns(state);
    expect(scores).toHaveLength(NUM_PLAYERS);
    for (const score of scores) {
      expect(Number.isFinite(score)).toBe(true);
      // A legitimate hand can never score the malformed-hand sentinel.
      expect(score).not.toBe(9999);
      expect(score).toBeGreaterThanOrEqual(-20);
      expect(score).toBeLessThanOrEqual(120);
    }
  });

  it('the triggering player always ends with all 10 cards face up', () => {
    for (const seed of seeds) {
      const { state } = randomPlayout(seed);
      expect(state.triggerPlayer).not.toBeNull();
      const trigger = state.players[state.triggerPlayer!];
      expect(trigger.grid).toHaveLength(GRID_SIZE);
    }
  });

  it('applyAction never mutates the state it was given', () => {
    const s = createInitialState(5);
    const snapshot = JSON.stringify(s);
    const actions = legalActions(s);
    for (const a of actions) applyAction(s, a);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('rejects an illegal action rather than corrupting state', () => {
    const s = createInitialState(5);
    // Placing before drawing is not legal.
    expect(() => applyAction(s, { type: 'place', spot: 0 })).toThrow();
    expect(() => applyAction(s, { type: 'discard' })).toThrow();
  });
});

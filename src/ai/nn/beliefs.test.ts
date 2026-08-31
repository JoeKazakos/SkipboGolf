import { describe, expect, it } from 'vitest';
import { DECK_SIZE, type Rank } from '../../engine/cards';
import { makeRng } from '../../engine/rng';
import { applyAction, createInitialState, isTerminal, legalActions } from '../../engine/state';
import type { GameState } from '../../engine/types';
import { determinize } from '../ismcts';
import { deckRankCounts } from '../heuristic';

/**
 * Gates for the belief-weighted deal.
 *
 * A weighted deal changes WHICH world gets sampled, and must not change what
 * counts as a world. If it can produce a state holding fourteen 4s, or lose a
 * card id, nothing downstream reports it - the search simply reasons about
 * positions that cannot exist, and every measurement taken with it is void.
 * These are the invariants the uniform deal has always satisfied.
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

/** Every card in the world, by rank, and every id exactly once. */
function census(s: GameState): { ranks: number[]; ids: Set<number>; total: number } {
  const ranks = new Array<number>(14).fill(0);
  const ids = new Set<number>();
  let total = 0;
  const add = (c: { rank: number; id: number }) => {
    ranks[c.rank] += 1;
    ids.add(c.id);
    total += 1;
  };
  for (const p of s.players) {
    for (const slot of p.grid) add(slot.card);
    for (const c of p.discard) add(c);
  }
  for (const c of s.drawPile) add(c);
  if (s.centerCard) add(s.centerCard);
  if (s.held) add(s.held);
  return { ranks, ids, total };
}

/** Heavily favours one rank, to make the weighting's effect measurable. */
function favour(rank: Rank): number[] {
  const w = new Array<number>(14).fill(1);
  w[rank] = 200;
  return w;
}

describe('belief-weighted determinization', () => {
  it('produces a legal world: every card accounted for, every id once', () => {
    const deck = deckRankCounts();
    const rng = makeRng(99);
    let checked = 0;
    for (const players of [2, 4, 6, 7]) {
      for (const steps of [12, 55, 140]) {
        const s = midGame(400 + players + steps, players, steps);
        const beliefs = s.players.map((_, i) => favour(((i % 13) + 1) as Rank));
        for (let w = 0; w < 6; w++) {
          const world = determinize(s, s.current, rng, beliefs);
          const c = census(world);
          expect(c.total).toBe(DECK_SIZE);
          expect(c.ids.size).toBe(DECK_SIZE);
          for (let r = 1; r <= 13; r++) expect(c.ranks[r]).toBe(deck[r]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('leaves every visible card exactly where it was', () => {
    const rng = makeRng(7);
    const s = midGame(777, 5, 70);
    const beliefs = s.players.map(() => favour(7));
    for (let w = 0; w < 5; w++) {
      const world = determinize(s, s.current, rng, beliefs);
      for (let p = 0; p < s.players.length; p++) {
        for (let i = 0; i < s.players[p].grid.length; i++) {
          if (s.players[p].grid[i].faceUp) {
            expect(world.players[p].grid[i].card).toEqual(s.players[p].grid[i].card);
          }
        }
        // The top three of each pile are public and must survive untouched.
        const d = s.players[p].discard;
        const wd = world.players[p].discard;
        for (let i = Math.max(0, d.length - 3); i < d.length; i++) expect(wd[i]).toEqual(d[i]);
      }
      expect(world.centerCard).toEqual(s.centerCard);
    }
  });

  it('actually shifts the deal toward the favoured rank', () => {
    // Without this the whole feature could be a no-op and every other test
    // here would still pass.
    const s = midGame(31337, 4, 60);
    const target: Rank = 5;
    const count = (world: GameState, seat: number) =>
      world.players[seat].grid.filter(
        (slot, i) => !s.players[seat].grid[i].faceUp && slot.card.rank === target,
      ).length;

    let weighted = 0;
    let uniform = 0;
    const rngA = makeRng(11);
    const rngB = makeRng(11);
    const beliefs = s.players.map((_, i) => (i === 1 ? favour(target) : undefined));
    for (let w = 0; w < 200; w++) {
      weighted += count(determinize(s, s.current, rngA, beliefs), 1);
      uniform += count(determinize(s, s.current, rngB), 1);
    }
    expect(weighted).toBeGreaterThan(uniform * 1.5);
  });

  it('falls back to a uniform deal when the weights are degenerate', () => {
    // A model that outputs zeros, or a seat with no entry, must not bias or
    // crash the deal - it should simply behave as it does today.
    const rng = makeRng(5);
    const s = midGame(2024, 6, 80);
    const deck = deckRankCounts();
    for (const beliefs of [
      s.players.map(() => new Array<number>(14).fill(0)),
      s.players.map(() => undefined),
    ]) {
      for (let w = 0; w < 4; w++) {
        const world = determinize(s, s.current, rng, beliefs);
        const c = census(world);
        expect(c.total).toBe(DECK_SIZE);
        for (let r = 1; r <= 13; r++) expect(c.ranks[r]).toBe(deck[r]);
      }
    }
  });

  it('is unchanged when no beliefs are passed', () => {
    // The negative gate: everything measured so far used the uniform deal, and
    // an argument nobody passes must not move those results.
    const s = midGame(1234, 6, 50);
    const a = determinize(s, s.current, makeRng(42));
    const b = determinize(s, s.current, makeRng(42), undefined);
    expect(b).toEqual(a);
  });
});

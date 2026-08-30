import { describe, expect, it } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { makeRng } from '../engine/rng';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import {
  createHeuristicAgent,
  evaluateGrid,
  expectedScore,
  heuristicAction,
  policyPriors,
  rolloutAction,
  turnSearchCosts,
  unseenRankCounts,
} from './heuristic';

let nextId = 50000;
const card = (rank: number): Card => ({ rank: rank as Rank, id: nextId++ });
const ranks = (values: number[]): Rank[] => values.map((v) => v as Rank);

/** A state whose current player has an exactly specified play area. */
function stateWithGrid(values: number[], faceUp: boolean[], seed = 1): GameState {
  const s = createInitialState(seed);
  s.players[0].grid = values.map((v, i) => ({ card: card(v), faceUp: faceUp[i] }));
  return s;
}

const allUp = new Array(10).fill(true);

describe('evaluateGrid', () => {
  it('agrees with the rules on a fully known hand, up to its shaping terms', () => {
    // Worked example 1 from section 12: base 4, two squares, final -16.
    const view = ranks([5, 5, 7, 8, 8, 5, 5, 4, 8, 8]);
    expect(expectedScore(view)).toBe(-16);
  });

  it('reproduces the overlapping-square ruling', () => {
    // Worked example 2: squares are counted left to right, no column reused.
    const view = ranks([9, 9, 9, 2, 2, 9, 9, 9, 2, 2]);
    expect(expectedScore(view)).toBe(-20);
  });

  it('treats 7, 11 and 13 as free cards', () => {
    const free = expectedScore(ranks([7, 11, 13, 1, 1, 2, 3, 4, 1, 1]));
    const costly = expectedScore(ranks([6, 10, 12, 1, 1, 2, 3, 4, 1, 1]));
    expect(free).toBeLessThan(costly);
    // Columns score 2 + 3 + 4 + 0 + 0, and the block of 1s is a square: 9 - 10.
    expect(free).toBe(-1);
  });

  it('prefers a cancelled column to a mismatched one', () => {
    const matched = evaluateGrid(ranks([4, 1, 1, 1, 1, 4, 1, 1, 1, 1]));
    const mismatched = evaluateGrid(ranks([4, 1, 1, 1, 1, 9, 1, 1, 1, 1]));
    expect(matched).toBeLessThan(mismatched);
  });

  it('credits an unknown card less than a bad known one and more than a good one', () => {
    const unknown = evaluateGrid([...ranks([3, 1, 1, 1, 1]), null, ...ranks([1, 1, 1, 1])]);
    const bad = evaluateGrid(ranks([3, 1, 1, 1, 1, 12, 1, 1, 1, 1]));
    const good = evaluateGrid(ranks([3, 1, 1, 1, 1, 3, 1, 1, 1, 1]));
    expect(unknown).toBeLessThan(bad);
    expect(unknown).toBeGreaterThan(good);
  });

  it('rewards turning cards face up, all else equal', () => {
    const hidden = evaluateGrid([...ranks([2, 2, 2, 2, 2]), null, ...ranks([2, 2, 2, 2])]);
    const revealed = evaluateGrid(ranks([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]));
    expect(revealed).toBeLessThan(hidden);
  });
});

/**
 * Plays the agent's whole turn out and reports the play area it settles on.
 * Asserting on the finished grid rather than one action keeps the fixtures
 * honest: several placement orders reach the same position.
 */
function playOutTurn(start: GameState): Rank[] {
  let s = start;
  for (let step = 0; step < 20; step++) {
    const action = heuristicAction(s);
    if (action.type === 'discard') break;
    s = applyAction(s, action);
  }
  return s.players[0].grid.map((slot) => slot.card.rank);
}

describe('heuristic move choice', () => {
  it('completes a 2x2 square rather than breaking one', () => {
    // Columns 1-2 are three quarters of a square of 6s; row 2 column 2 is a 12.
    const s = stateWithGrid([6, 6, 1, 2, 3, 6, 12, 1, 2, 3], allUp);
    s.phase = 'act';
    s.held = card(6);

    const finished = playOutTurn(s);
    expect(finished.slice(0, 2)).toEqual([6, 6]);
    expect([finished[5], finished[6]]).toEqual([6, 6]);
    expect(expectedScore(finished)).toBe(-10);
  });

  it('completes a matching column rather than leaving a high card exposed', () => {
    // Column 5 pairs 9 with 12. Holding a 12 turns it into a cancelled pair.
    const s = stateWithGrid([1, 1, 2, 2, 12, 1, 1, 2, 2, 9], allUp);
    s.phase = 'act';
    s.held = card(12);

    const finished = playOutTurn(s);
    expect(finished[4]).toBe(12);
    expect(finished[9]).toBe(12);
  });

  it('plays a 7 over a 12 because specials score nothing', () => {
    const s = stateWithGrid([1, 1, 2, 2, 12, 1, 1, 2, 2, 9], allUp);
    s.phase = 'act';
    s.held = card(7);

    const action = heuristicAction(s);
    expect(action.type).toBe('place');
    // Either half of the 12/9 column is fine; both remove a large value.
    expect([4, 9]).toContain((action as { spot: number }).spot);
  });

  it('discards rather than wrecking a finished play area', () => {
    const s = stateWithGrid([3, 3, 4, 4, 5, 3, 3, 4, 4, 5], allUp);
    s.phase = 'act';
    s.held = card(12);

    expect(heuristicAction(s)).toEqual({ type: 'discard' });
  });

  it('never plans a wave chain through a card it cannot see', () => {
    // Row 2 column 1 is face down. Placing there reveals a card the agent has no
    // right to know, so the search must not value the chain it would allow.
    const s = stateWithGrid([8, 1, 2, 3, 4, 9, 1, 2, 3, 4], [
      true, true, true, true, true,
      false, true, true, true, true,
    ]);
    s.phase = 'act';
    s.held = card(8);

    const actions = legalActions(s);
    const withHidden = turnSearchCosts(s, actions);
    // Swapping the hidden card for a different one must not change any cost.
    s.players[0].grid[5] = { card: card(2), faceUp: false };
    expect(turnSearchCosts(s, actions)).toEqual(withHidden);
  });
});

describe('agent legality', () => {
  const agents = [
    { name: 'heuristic', pick: (s: GameState) => heuristicAction(s) },
    { name: 'rollout', pick: ((): ((s: GameState) => Action) => {
      const rng = makeRng(11);
      return (s: GameState) => rolloutAction(s, rng);
    })() },
  ];

  for (const agent of agents) {
    it(`${agent.name} only ever returns a legal action`, () => {
      const rng = makeRng(3);
      for (let game = 0; game < 4; game++) {
        let s = createInitialState(100 + game);
        let steps = 0;
        while (!s.terminal && steps < 1500) {
          const legal = legalActions(s);
          // Interleave random play so the agents are tested on varied positions.
          const action = rng.next() < 0.5 ? agent.pick(s) : legal[Math.floor(rng.next() * legal.length)];
          expect(legal).toContainEqual(action);
          s = applyAction(s, action);
          steps += 1;
        }
        expect(s.terminal).toBe(true);
      }
    });
  }
});

describe('policyPriors', () => {
  it('scores every legal action and favours the heuristic pick', () => {
    const s = stateWithGrid([1, 1, 2, 2, 12, 1, 1, 2, 2, 9], allUp);
    s.phase = 'act';
    s.held = card(12);

    const actions = legalActions(s);
    const priors = policyPriors(s, actions);
    expect(priors).toHaveLength(actions.length);
    for (const p of priors) expect(p).toBeGreaterThanOrEqual(0);
    for (const p of priors) expect(p).toBeLessThanOrEqual(1);
    expect(Math.max(...priors)).toBe(1);
  });
});

describe('unseenRankCounts', () => {
  it('accounts for every card the viewer cannot see', () => {
    const s = createInitialState(31);
    const counts = unseenRankCounts(s, 0);
    let unseen = 0;
    for (let rank = 1; rank <= 13; rank++) {
      expect(counts[rank]).toBeGreaterThanOrEqual(0);
      unseen += counts[rank];
    }
    // 18 face-up grid cards plus the center card are visible at the deal.
    expect(unseen).toBe(162 - 19);
  });
});

describe('createHeuristicAgent', () => {
  it('plays a full six-player game without throwing', async () => {
    const agent = createHeuristicAgent();
    let s = createInitialState(4242);
    let steps = 0;
    while (!s.terminal && steps < 2000) {
      s = applyAction(s, await agent.chooseAction(s, s.current));
      steps += 1;
    }
    expect(s.terminal).toBe(true);
  });
});

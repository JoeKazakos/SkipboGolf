import { describe, expect, it } from 'vitest';
import { DECK_SIZE, GRID_SIZE, type Card, type Rank } from './cards';
import {
  NUM_PLAYERS,
  applyAction,
  createInitialState,
  isWaveLegal,
  legalActions,
  observationFor,
  returns,
} from './state';
import type { Action, GameState } from './types';

let nextId = 10000;
const card = (rank: number): Card => ({ rank: rank as Rank, id: nextId++ });

/** Builds a state whose current player has an exact grid, for rule fixtures. */
function stateWithGrid(ranks: number[], faceUp: boolean[]): GameState {
  const s = createInitialState(1);
  s.players[0].grid = ranks.map((r, i) => ({ card: card(r), faceUp: faceUp[i] }));
  return s;
}

const ranksOf = (s: GameState, p = 0) => s.players[p].grid.map((slot) => slot.card.rank);
const place = (spot: number): Action => ({ type: 'place', spot });

describe('deal', () => {
  const s = createInitialState(42);

  it('gives every player exactly 10 cards', () => {
    expect(s.players).toHaveLength(NUM_PLAYERS);
    for (const p of s.players) expect(p.grid).toHaveLength(GRID_SIZE);
  });

  it('starts with bottom-left, bottom-middle and bottom-right face up', () => {
    for (const p of s.players) {
      const up = p.grid.map((slot, i) => (slot.faceUp ? i : -1)).filter((i) => i >= 0);
      expect(up).toEqual([5, 7, 9]);
    }
  });

  it('turns one centre card face up and leaves the rest as the draw pile', () => {
    expect(s.centerCard).not.toBeNull();
    expect(s.drawPile).toHaveLength(DECK_SIZE - NUM_PLAYERS * GRID_SIZE - 1);
  });

  it('accounts for all 162 cards with no duplicates', () => {
    const ids = new Set<number>();
    for (const p of s.players) for (const slot of p.grid) ids.add(slot.card.id);
    for (const c of s.drawPile) ids.add(c.id);
    if (s.centerCard) ids.add(s.centerCard.id);
    expect(ids.size).toBe(DECK_SIZE);
  });
});

describe('draw legality', () => {
  it('offers the centre card, the pile, but never your own discard pile', () => {
    const s = createInitialState(7);
    s.players[0].discard.push(card(4));
    s.players[2].discard.push(card(9));
    const sources = legalActions(s)
      .filter((a) => a.type === 'draw')
      .map((a) => (a as Extract<Action, { type: 'draw' }>).source);

    expect(sources).toContainEqual({ kind: 'center' });
    expect(sources).toContainEqual({ kind: 'pile' });
    expect(sources).toContainEqual({ kind: 'discard', player: 2 });
    expect(sources).not.toContainEqual({ kind: 'discard', player: 0 });
  });

  it('removes the centre card permanently once taken', () => {
    let s = createInitialState(7);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    expect(s.centerCard).toBeNull();
    s = applyAction(s, { type: 'discard' });
    const sources = legalActions(s).filter(
      (a) => a.type === 'draw' && a.source.kind === 'center',
    );
    expect(sources).toHaveLength(0);
  });

  it('rebuilds the draw pile from the discards when it empties', () => {
    let s = createInitialState(7);
    s.drawPile = [];
    // Give each player a pile of three so there is something to gather.
    for (const p of s.players) p.discard = [card(2), card(3), card(4)];
    s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });

    expect(s.held).not.toBeNull();
    // Each player keeps their own top card; the rest were reshuffled.
    for (const p of s.players) expect(p.discard).toHaveLength(1);
    expect(s.drawPile.length).toBe(NUM_PLAYERS * 2 - 1);
  });
});

describe('placement and wave legality', () => {
  it('lets the first placement of a turn target any spot', () => {
    let s = stateWithGrid([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [false, false, false, false, false, true, true, true, true, true]);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    const spots = legalActions(s)
      .filter((a) => a.type === 'place')
      .map((a) => (a as Extract<Action, { type: 'place' }>).spot);
    expect(spots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('restricts later placements to legal waves only', () => {
    // Exactly one visible 8, at index 3 (row 1, col 4); holding an 8 after one placement.
    let s = stateWithGrid([1, 2, 3, 8, 5, 6, 7, 9, 10, 11], [false, false, false, true, false, true, true, true, true, true]);
    s.phase = 'act';
    s.held = card(8);
    s.placements = 1;
    const spots = legalActions(s)
      .filter((a) => a.type === 'place')
      .map((a) => (a as Extract<Action, { type: 'place' }>).spot);
    // Only index 8, the spot opposite the visible 8, is wave-legal.
    expect(spots).toEqual([8]);
  });

  it('requires the matched card to be face up', () => {
    const s = stateWithGrid([1, 2, 3, 8, 5, 6, 7, 8, 9, 10], new Array(10).fill(false));
    s.phase = 'act';
    s.held = card(8);
    s.placements = 1;
    expect(isWaveLegal(s, 8)).toBe(false);
  });

  it('always allows a discard, even when a wave is available', () => {
    const s = stateWithGrid([1, 2, 3, 8, 5, 6, 7, 8, 9, 10], [false, false, false, true, false, true, true, true, true, true]);
    s.phase = 'act';
    s.held = card(8);
    s.placements = 1;
    expect(legalActions(s)).toContainEqual({ type: 'discard' });
  });

  it('turns a placed card face up and hands back the displaced card', () => {
    let s = stateWithGrid([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], new Array(10).fill(false));
    s.phase = 'act';
    s.held = card(11);
    s = applyAction(s, place(0));
    expect(s.players[0].grid[0].card.rank).toBe(11);
    expect(s.players[0].grid[0].faceUp).toBe(true);
    expect(s.held?.rank).toBe(1);
  });
});

describe('spot locking (section 15.1)', () => {
  it('locks a spot after it is played into', () => {
    let s = stateWithGrid([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], new Array(10).fill(false));
    s.phase = 'act';
    s.held = card(11);
    s = applyAction(s, place(3));
    expect(s.locked[3]).toBe(true);
    expect(() => applyAction(s, place(3))).toThrow(/already played/);
  });

  it('never allows more than 10 placements in a turn', () => {
    let s = stateWithGrid([5, 5, 5, 5, 5, 5, 5, 5, 5, 5], new Array(10).fill(true));
    s.phase = 'act';
    s.held = card(5);
    let placements = 0;
    while (legalActions(s).some((a) => a.type === 'place')) {
      const next = legalActions(s).find((a) => a.type === 'place')!;
      s = applyAction(s, next);
      placements++;
      expect(placements).toBeLessThanOrEqual(GRID_SIZE);
    }
    expect(placements).toBe(GRID_SIZE);
  });

  it('clears the locks at the start of the next turn', () => {
    let s = stateWithGrid([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], new Array(10).fill(false));
    s.phase = 'act';
    s.held = card(11);
    s = applyAction(s, place(3));
    s = applyAction(s, { type: 'discard' });
    expect(s.locked.every((l) => !l)).toBe(true);
    expect(s.placements).toBe(0);
    expect(s.current).toBe(1);
  });
});

describe('the worked wave example from section 9', () => {
  // Row 1: ?  3  ?  8  ?      face-down values: 7 at idx0, 5 at idx2, 3 at idx4
  // Row 2: 12 ?  7  ?  1      face-down values: 12 at idx6, 1 at idx8
  const RANKS = [7, 3, 5, 8, 3, 12, 12, 7, 1, 1];
  const FACE_UP = [false, true, false, true, false, true, false, true, false, true];

  it('plays the full chain and ends with every card face up', () => {
    let s = stateWithGrid(RANKS, FACE_UP);
    s.centerCard = card(8);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    expect(s.held?.rank).toBe(8);

    // Step 1: the 8 goes opposite the visible 8, revealing a 1.
    s = applyAction(s, place(8));
    expect(s.held?.rank).toBe(1);

    // Step 2: the 1 goes opposite the visible 1, revealing a 3.
    s = applyAction(s, place(4));
    expect(s.held?.rank).toBe(3);

    // Step 3: the 3 goes opposite the visible 3, revealing a 12.
    s = applyAction(s, place(6));
    expect(s.held?.rank).toBe(12);

    // Step 4: the 12 goes opposite the visible 12, revealing a 7.
    s = applyAction(s, place(0));
    expect(s.held?.rank).toBe(7);

    // Step 5: the 7 goes opposite the visible 7, revealing a 5.
    s = applyAction(s, place(2));
    expect(s.held?.rank).toBe(5);

    // Step 6: no visible 5 anywhere, so the chain is over.
    expect(legalActions(s).filter((a) => a.type === 'place')).toHaveLength(0);

    expect(ranksOf(s)).toEqual([12, 3, 7, 8, 1, 12, 3, 7, 8, 1]);
    expect(s.players[0].grid.every((slot) => slot.faceUp)).toBe(true);
  });

  it('triggers the round end and scores the board at 0', () => {
    let s = stateWithGrid(RANKS, FACE_UP);
    s.centerCard = card(8);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    for (const spot of [8, 4, 6, 0, 2]) s = applyAction(s, place(spot));
    s = applyAction(s, { type: 'discard' });

    expect(s.triggerPlayer).toBe(0);
    expect(s.finalTurnsRemaining).toBe(NUM_PLAYERS - 1);
    expect(returns(s)[0]).toBe(0);
  });
});

describe('round end and the final turn cycle', () => {
  const RANKS = [7, 3, 5, 8, 3, 12, 12, 7, 1, 1];
  const FACE_UP = [false, true, false, true, false, true, false, true, false, true];

  function triggeredState(): GameState {
    let s = stateWithGrid(RANKS, FACE_UP);
    s.centerCard = card(8);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    for (const spot of [8, 4, 6, 0, 2]) s = applyAction(s, place(spot));
    return applyAction(s, { type: 'discard' });
  }

  it('gives every other player exactly one final turn', () => {
    let s = triggeredState();
    const seen: number[] = [];
    let guard = 0;
    while (!s.terminal && guard++ < 100) {
      seen.push(s.current);
      s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
      s = applyAction(s, { type: 'discard' });
    }
    expect(s.terminal).toBe(true);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not give the triggering player another turn', () => {
    let s = triggeredState();
    let guard = 0;
    while (!s.terminal && guard++ < 100) {
      expect(s.current).not.toBe(s.triggerPlayer);
      s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
      s = applyAction(s, { type: 'discard' });
    }
    expect(s.terminal).toBe(true);
  });

  it('reveals every hand once the round is over', () => {
    let s = triggeredState();
    let guard = 0;
    while (!s.terminal && guard++ < 100) {
      s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
      s = applyAction(s, { type: 'discard' });
    }
    for (const p of s.players) expect(p.grid.every((slot) => slot.faceUp)).toBe(true);
    expect(returns(s)).toHaveLength(NUM_PLAYERS);
    expect(legalActions(s)).toHaveLength(0);
  });
});

describe('observation', () => {
  it('hides face-down cards and shows only the top three discards', () => {
    const s = createInitialState(3);
    s.players[1].discard = [card(1), card(2), card(3), card(4), card(5)];
    const obs = observationFor(s, 0);

    const hidden = obs.players[1].grid.filter((g) => !g.faceUp);
    expect(hidden).toHaveLength(GRID_SIZE - 3);
    expect(obs.players[1].discardTop3.map((c) => c.rank)).toEqual([3, 4, 5]);
    expect(obs.players[1].discardCount).toBe(5);
  });

  it('does not reveal another player held card', () => {
    let s = createInitialState(3);
    s = applyAction(s, { type: 'draw', source: { kind: 'center' } });
    expect(observationFor(s, 0).held).not.toBeNull();
    expect(observationFor(s, 1).held).toBeNull();
  });
});

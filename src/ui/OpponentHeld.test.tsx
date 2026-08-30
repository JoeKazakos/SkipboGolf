import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from './App';
import { applyAction, createInitialState } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import type { Agent } from '../ai/agent';

/** An opponent that never decides, so the board holds still while we assert. */
const idleAgent: Agent = {
  name: 'idle',
  chooseAction: () => new Promise<Action>(() => {}),
};

/** Advances until it is an opponent's turn, then has them draw as given. */
function opponentHolding(source: 'center' | 'pile'): GameState {
  let s = createInitialState(21);
  // Player 0 takes a full turn so the turn passes to player 1.
  s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
  s = applyAction(s, { type: 'discard' });
  expect(s.current).not.toBe(0);
  return applyAction(s, { type: 'draw', source: { kind: source } });
}

describe("an opponent's held card", () => {
  it('is shown face up when everyone saw the draw', () => {
    const s = opponentHolding('center');
    expect(s.heldIsPublic).toBe(true);
    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);

    const slot = screen.getByTestId('opponent-held');
    const card = within(slot).getByRole('img');
    expect(card.getAttribute('data-facedown')).toBe('false');
    expect(card.getAttribute('data-rank')).toBe(String(s.held?.rank));
  });

  it('is shown face up after a pile draw, which is turned over when taken', () => {
    const s = opponentHolding('pile');
    expect(s.heldIsPublic).toBe(true);
    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);

    const slot = screen.getByTestId('opponent-held');
    const card = within(slot).getByRole('img');
    expect(card.getAttribute('data-facedown')).toBe('false');
    expect(card.getAttribute('data-rank')).toBe(String(s.held?.rank));
  });

  it('is shown face down, with no rank anywhere, when lifted from a hidden spot', () => {
    // The remaining private case, and the one the leak test must guard.
    let s = opponentHolding('center');
    const faceDown = s.players[s.current].grid.findIndex((slot) => !slot.faceUp);
    s = applyAction(s, { type: 'place', spot: faceDown });
    expect(s.heldIsPublic).toBe(false);
    const secret = s.held?.rank as number;

    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    const slot = screen.getByTestId('opponent-held');
    const card = within(slot).getByRole('img');
    expect(card.getAttribute('data-facedown')).toBe('true');
    expect(card.getAttribute('data-rank')).toBeNull();

    // The leak test: the hidden rank must not appear in that slot at all.
    expect(slot.textContent ?? '').not.toContain(String(secret));
    expect(slot.querySelector('[data-rank]')).toBeNull();
  });

  it('is absent when the player to move holds nothing', () => {
    let s = createInitialState(21);
    s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
    s = applyAction(s, { type: 'discard' });
    expect(s.held).toBeNull();
    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    expect(screen.queryByTestId('opponent-held')).toBeNull();
  });

  it('is not shown on the human\'s own seat, which has its own holding slot', () => {
    const s = applyAction(createInitialState(21), {
      type: 'draw',
      source: { kind: 'center' },
    });
    expect(s.current).toBe(0);
    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    expect(screen.queryByTestId('opponent-held')).toBeNull();
  });
});

describe('the in-hand slot does not move the board', () => {
  it('reserves its space whether or not a card is held', () => {
    const idle = (() => {
      let s = createInitialState(21);
      s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
      return applyAction(s, { type: 'discard' });
    })();
    const { unmount } = render(<App initialState={idle} agent={idleAgent} aiDelayMs={0} />);
    const emptySlots = document.querySelectorAll('.seat--opponent .seat__held').length;
    unmount();

    const holding = opponentHolding('center');
    render(<App initialState={holding} agent={idleAgent} aiDelayMs={0} />);
    const filledSlots = document.querySelectorAll('.seat--opponent .seat__held').length;

    // Present in both states, so nothing appears or disappears from the layout.
    expect(emptySlots).toBe(filledSlots);
    expect(emptySlots).toBeGreaterThan(0);
  });

  it('sits alongside the discard, below the grid, not above it', () => {
    const s = opponentHolding('center');
    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    const seat = document.querySelector('.seat--opponent') as HTMLElement;
    const foot = seat.querySelector('.seat__foot') as HTMLElement;
    // The held slot and the discard share the footer row.
    expect(foot.querySelector('.seat__held')).toBeTruthy();
    expect(foot.querySelector('.seat__discard')).toBeTruthy();
    // And the footer comes after the grid in document order.
    const grid = seat.querySelector('.grid--sm') as HTMLElement;
    expect(grid.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

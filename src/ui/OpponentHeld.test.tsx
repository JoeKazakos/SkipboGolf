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

  it('is shown face down, with no rank anywhere, after a blind draw', () => {
    const s = opponentHolding('pile');
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

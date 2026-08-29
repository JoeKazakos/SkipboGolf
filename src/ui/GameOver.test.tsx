import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyAction, createInitialState, isTerminal, legalActions } from '../engine/state';
import type { GameState } from '../engine/types';
import { GameOver } from './GameOver';

/** Plays a deterministic game to its end, so the scorecard has real data. */
function terminalState(seed: number): GameState {
  let s = createInitialState(seed);
  let guard = 0;
  while (!isTerminal(s)) {
    if (guard++ > 20000) throw new Error('game failed to terminate');
    const actions = legalActions(s);
    s = applyAction(s, actions[guard % actions.length]);
  }
  return s;
}

const NAMES = ['You', 'Zara', 'Yusuf', 'Xan', 'Wren', 'Vic'] as const;

describe('GameOver', () => {
  it('names every player from the seating, not from the default roster', () => {
    // Regression: the ranking rows called playerName without the seat names,
    // so a scorecard headed "Nel wins" listed Baz, Cleo, Dex and Etta beneath.
    render(<GameOver state={terminalState(4242)} names={NAMES} onNewGame={vi.fn()} />);

    const shown = screen
      .getAllByTestId('final-score')
      .map((row) => row.querySelector('.scoreline__name')?.textContent ?? '');
    expect(new Set(shown)).toEqual(new Set(NAMES));

    // None of the stock names may leak through.
    for (const stock of ['Ada', 'Baz', 'Cleo', 'Dex', 'Etta']) {
      expect(screen.queryByText(stock)).toBeNull();
    }
  });

  it('names the winner with the same seating', () => {
    render(<GameOver state={terminalState(99)} names={NAMES} onNewGame={vi.fn()} />);
    const winner = screen.getByTestId('winner').textContent ?? '';
    const named = NAMES.filter((n) => winner.includes(n));
    expect(named.length).toBeGreaterThan(0);
  });

  it('lists all six players, best score first', () => {
    render(<GameOver state={terminalState(7)} names={NAMES} onNewGame={vi.fn()} />);
    const rows = screen.getAllByTestId('final-score');
    expect(rows).toHaveLength(6);
    const scores = rows.map((r) => Number(r.getAttribute('data-score')));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
});

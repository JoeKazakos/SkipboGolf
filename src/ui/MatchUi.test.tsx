import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameOver } from './GameOver';
import { SettingsProvider } from './settings';
import { applyAction, createInitialState, isTerminal, legalActions, returns } from '../engine/state';
import type { GameState } from '../engine/types';

function terminalState(seed: number): GameState {
  let s = createInitialState(seed);
  let guard = 0;
  while (!isTerminal(s)) {
    if (guard++ > 20000) throw new Error('no termination');
    const a = legalActions(s);
    s = applyAction(s, a[guard % a.length]);
  }
  return s;
}

const NAMES = ['You', 'A', 'B', 'C', 'D', 'E'] as const;

function renderCard(match: Parameters<typeof GameOver>[0]['match'], state = terminalState(4242)) {
  render(
    <SettingsProvider>
      <GameOver state={state} names={NAMES} match={match} onNewGame={vi.fn()} />
    </SettingsProvider>,
  );
  return state;
}

describe('match scorecard', () => {
  it('adds the round just played to the standings', () => {
    const before = [10, 20, 30, 40, 50, 60];
    const state = renderCard({ label: 'Round 2 of 3', totalsBefore: before, isOver: false });
    const roundScores = returns(state);

    for (const li of screen.getAllByTestId('standing')) {
      const player = Number(li.getAttribute('data-player'));
      const shown = Number(li.getAttribute('data-total'));
      // The whole point: totalsBefore alone would omit this round.
      expect(shown).toBe(before[player] + roundScores[player]);
    }
  });

  it('sorts standings by total, lowest first', () => {
    renderCard({ label: 'Round 2 of 3', totalsBefore: [0, 0, 0, 0, 0, 0], isOver: false });
    const totals = screen.getAllByTestId('standing').map((li) => Number(li.getAttribute('data-total')));
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it('says "Round over" mid-match and "Match over" at the end', () => {
    renderCard({ label: 'Round 1 of 3', totalsBefore: [0, 0, 0, 0, 0, 0], isOver: false });
    expect(screen.getByText('Round over')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next round' })).toBeTruthy();
  });

  it('offers a new match once the last round is done', () => {
    renderCard({ label: 'Round 3 of 3', totalsBefore: [1, 2, 3, 4, 5, 6], isOver: true });
    expect(screen.getByText('Match over')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New match' })).toBeTruthy();
    expect(screen.getByText('Final match standings')).toBeTruthy();
  });

  it('shows no standings at all in a single-round game', () => {
    renderCard(undefined);
    expect(screen.queryByTestId('standings')).toBeNull();
    expect(screen.getByRole('button', { name: /Deal a new round/ })).toBeTruthy();
  });
});

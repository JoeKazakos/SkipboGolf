import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';
import { ProfilesProvider } from './ProfilesContext';
import { PROVISIONAL_GAMES, type PlayedGame } from './rating';

function seed(games: PlayedGame[]) {
  localStorage.setItem(
    'skipbo-golf.profiles.v1',
    JSON.stringify({
      profiles: [{ id: 'p1', name: 'Joe', createdAt: '2026-08-30T00:00:00.000Z' }],
      activeId: 'p1',
      games: { p1: games },
    }),
  );
}

const game = (i: number, mine: number): PlayedGame => ({
  at: `2026-08-${String(10 + (i % 20)).padStart(2, '0')}T00:00:00.000Z`,
  seats: ['nel', 'ada'],
  scores: [mine, 12, 15],
});

const show = () =>
  render(
    <ProfilesProvider>
      <HistoryPanel onClose={vi.fn()} />
    </ProfilesProvider>,
  );

beforeEach(() => localStorage.clear());

describe('HistoryPanel', () => {
  it('says so when nothing has been recorded', () => {
    seed([]);
    show();
    expect(screen.getByTestId('history-panel').textContent).toMatch(/No games recorded yet/);
  });

  it('lists every recorded round', () => {
    seed([game(0, 5), game(1, 30), game(2, 8)]);
    show();
    expect(screen.getAllByTestId('game-row')).toHaveLength(3);
  });

  it('shows a band rather than a number while provisional', () => {
    seed([game(0, 5), game(1, 30)]);
    show();
    const value = screen.getByTestId('rating-value').textContent ?? '';
    expect(value).toMatch(/provisional/);
    // A tilde and a name, not a bare rating.
    expect(value).toMatch(/~[A-Z]/);
  });

  it('quotes a number with its error bar once enough rounds are played', () => {
    seed(Array.from({ length: PROVISIONAL_GAMES + 2 }, (_, i) => game(i, i % 2 === 0 ? 5 : 30)));
    show();
    const value = screen.getByTestId('rating-value').textContent ?? '';
    expect(value).toMatch(/^\d+/);
    expect(value).toMatch(/±\d+/);
  });

  it('draws the uncertainty band, not just a line', () => {
    seed(Array.from({ length: 6 }, (_, i) => game(i, i % 2 === 0 ? 5 : 30)));
    show();
    const chart = screen.getByTestId('rating-chart');
    expect(chart.querySelector('.chart__band')).toBeTruthy();
    expect(chart.querySelector('.chart__line')).toBeTruthy();
  });

  it('names the opponents faced in each round', () => {
    seed([game(0, 5)]);
    show();
    const row = screen.getAllByTestId('game-row')[0];
    expect(within(row).getByText(/vs Nel, Ada/)).toBeTruthy();
  });

  it('keeps records separate per profile', () => {
    localStorage.setItem(
      'skipbo-golf.profiles.v1',
      JSON.stringify({
        profiles: [
          { id: 'p1', name: 'Joe', createdAt: '2026-08-30T00:00:00.000Z' },
          { id: 'p2', name: 'Sam', createdAt: '2026-08-30T00:00:00.000Z' },
        ],
        activeId: 'p2',
        games: { p1: [game(0, 5), game(1, 6)], p2: [game(2, 7)] },
      }),
    );
    show();
    expect(screen.getByTestId('history-panel').textContent).toMatch(/Sam's record/);
    expect(screen.getAllByTestId('game-row')).toHaveLength(1);
  });
});

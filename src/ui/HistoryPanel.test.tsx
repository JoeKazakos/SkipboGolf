import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';
import { ProfilesProvider } from './ProfilesContext';
import { PROVISIONAL_GAMES, type PlayedGame } from './rating';
import { ROSTER } from '../ai/roster';

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

  it('keeps the chart axis inside a readable range', () => {
    // A long, varied record: the axis must sit near the ratings the opponents
    // actually occupy, not stretch to thousands because of one early fit.
    seed(Array.from({ length: 30 }, (_, i) => game(i, i % 3 === 0 ? 4 : 25)));
    show();
    const chart = screen.getByTestId('rating-chart');
    const ticks = [...chart.querySelectorAll('.chart__tick')].map((t) =>
      Number(t.textContent),
    );
    for (const tick of ticks) {
      expect(tick).toBeGreaterThan(0);
      expect(tick).toBeLessThan(3000);
    }
  });

  it('says so rather than drawing nonsense when the fits are still vague', () => {
    // Two rounds, both won: the fit pegs high with enormous error.
    seed([game(0, -5), game(1, -5)]);
    show();
    expect(screen.queryByTestId('rating-chart')).toBeNull();
    expect(screen.getByTestId('chart-pending')).toBeTruthy();
  });

  it('draws the uncertainty band, not just a line', () => {
    seed(Array.from({ length: 30 }, (_, i) => game(i, i % 2 === 0 ? 5 : 30)));
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

describe('when a round was played', () => {
  it('shows a time alongside the date for every round', () => {
    seed([game(0, 5), game(1, 12)]);
    show();
    const rows = screen.getAllByTestId('game-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const time = within(row).getByTestId('record-time').textContent ?? '';
      // A clock time of some locale form, not an empty cell.
      expect(time).toMatch(/\d/);
      expect(time).toMatch(/[:.]/);
    }
  });

  it('distinguishes two rounds played on the same day', () => {
    seed([
      { at: '2026-08-30T09:15:00.000Z', seats: ['nel'], scores: [5, 9] },
      { at: '2026-08-30T21:40:00.000Z', seats: ['nel'], scores: [7, 9] },
    ]);
    show();
    const times = screen.getAllByTestId('record-time').map((el) => el.textContent);
    expect(times[0]).not.toBe(times[1]);
  });

  it('does not crash on a record with an unusable timestamp', () => {
    seed([{ at: 'not-a-date', seats: ['nel'], scores: [5, 9] }]);
    show();
    expect(screen.getAllByTestId('game-row')).toHaveLength(1);
    expect(screen.getByText('unknown')).toBeTruthy();
  });
});

describe('opponent reference lines', () => {
  it('marks the opponents the player is being compared against', () => {
    seed(Array.from({ length: 30 }, (_, i) => game(i, i % 3 === 0 ? 4 : 22)));
    show();
    const chart = screen.getByTestId('rating-chart');
    const refs = [...chart.querySelectorAll('.chart__ref text')].map((t) => t.textContent ?? '');
    expect(refs.length).toBeGreaterThan(0);
    // Every label names a real roster opponent.
    const names = new Set(ROSTER.map((p) => p.name));
    for (const label of refs) {
      for (const part of label.split(', ')) expect(names.has(part)).toBe(true);
    }
  });

  it('describes them to a screen reader too', () => {
    seed(Array.from({ length: 30 }, (_, i) => game(i, i % 3 === 0 ? 4 : 22)));
    show();
    const label = screen.getByTestId('rating-chart').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/Shown against/);
  });

  it('draws no reference outside the visible range', () => {
    seed(Array.from({ length: 30 }, (_, i) => game(i, i % 3 === 0 ? 4 : 22)));
    show();
    const chart = screen.getByTestId('rating-chart');
    const ticks = [...chart.querySelectorAll('.chart__tick')].map((t) => Number(t.textContent));
    const lo = Math.min(...ticks);
    const hi = Math.max(...ticks);
    const shown = [...chart.querySelectorAll('.chart__ref text')]
      .flatMap((t) => (t.textContent ?? '').split(', '))
      .map((n) => ROSTER.find((p) => p.name === n)?.elo)
      .filter((e): e is number => e != null);
    for (const elo of shown) {
      expect(elo).toBeGreaterThanOrEqual(lo);
      expect(elo).toBeLessThanOrEqual(hi);
    }
  });
});

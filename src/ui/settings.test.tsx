import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GameOver } from './GameOver';
import { SettingsPanel, SettingsProvider, DEFAULT_SETTINGS, loadSettings } from './settings';
import { applyAction, createInitialState, isTerminal, legalActions } from '../engine/state';
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

beforeEach(() => localStorage.clear());

describe('settings storage', () => {
  it('falls back to defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives a malformed or stale stored blob rather than throwing', () => {
    localStorage.setItem('skipbo-golf.settings.v1', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('skipbo-golf.settings.v1', '{"showScoreBreakdown":"yes"}');
    expect(loadSettings().showScoreBreakdown).toBe(DEFAULT_SETTINGS.showScoreBreakdown);
  });

  it('persists a change', () => {
    render(
      <SettingsProvider>
        <SettingsPanel onClose={() => {}} />
      </SettingsProvider>,
    );
    const box = screen.getByRole('checkbox', { name: /Explain the final score/ });
    fireEvent.click(box);
    expect(loadSettings().showScoreBreakdown).toBe(false);
  });
});

describe('score working on the scorecard', () => {
  const renderCard = () =>
    render(
      <SettingsProvider>
        <GameOver state={terminalState(4242)} names={NAMES} onNewGame={() => {}} />
      </SettingsProvider>,
    );

  it('is shown by default and explains every column', () => {
    renderCard();
    const workings = screen.getAllByTestId('score-working');
    expect(workings).toHaveLength(6);
    // Five columns explained per player.
    expect(within(workings[0]).getAllByText(/^Col [1-5]$/)).toHaveLength(5);
    expect(within(workings[0]).getByText(/Total/)).toBeTruthy();
  });

  it('is hidden when the setting is off', () => {
    localStorage.setItem(
      'skipbo-golf.settings.v1',
      JSON.stringify({ ...DEFAULT_SETTINGS, showScoreBreakdown: false }),
    );
    renderCard();
    expect(screen.queryByTestId('score-working')).toBeNull();
  });

  it('never contradicts the score it is explaining', () => {
    renderCard();
    const rows = screen.getAllByTestId('final-score');
    for (const row of rows) {
      const awarded = Number(row.getAttribute('data-score'));
      const working = within(row).getByTestId('score-working');
      // The working ends with "Total <n>."
      const text = working.textContent ?? '';
      const m = text.match(/Total\s+(-?\d+)\./);
      expect(m, `no total found in: ${text}`).toBeTruthy();
      expect(Number(m![1])).toBe(awarded);
    }
  });
});

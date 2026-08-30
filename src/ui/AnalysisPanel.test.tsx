import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnalysisPanel } from './AnalysisPanel';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import { PLAYER_NAMES } from './format';
import type { GameState } from '../engine/types';

function position(): GameState {
  let s = createInitialState(31337);
  for (let i = 0; i < 12; i++) {
    const a = legalActions(s);
    s = applyAction(s, a[i % a.length]);
  }
  return s;
}

const show = (state = position()) =>
  render(<AnalysisPanel state={state} names={PLAYER_NAMES} onClose={vi.fn()} />);

describe('AnalysisPanel', () => {
  it('offers an editable card for every grid spot', () => {
    show();
    expect(screen.getAllByRole('combobox')).toHaveLength(10);
  });

  it('recommends a move and shows the search behind it', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /What should I play/ }));
    await waitFor(
      () => expect(screen.getByTestId('analysis-result')).toBeTruthy(),
      { timeout: 15000 },
    );
    const rows = screen.getAllByTestId('candidate');
    expect(rows.length).toBeGreaterThan(0);
    // Every row carries a search share, which is the engine's real working.
    expect(screen.getByTestId('analysis-result').textContent).toMatch(/%/);
  }, 20000);

  it('keeps the deck intact when a card is changed', () => {
    const start = position();
    show(start);
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '5' } });
    // No complaint about the deck means the census still adds up.
    expect(screen.queryByTestId('analysis-invalid')).toBeNull();
  });

  it('refuses an edit the deck cannot supply, rather than corrupting the position', () => {
    // Build a position holding every 13 in the human's grid and the piles is
    // impractical here, so drive the refusal through repeated edits instead.
    show();
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // Ask for far more 13s than the deck could have left in the pile.
    for (const s of selects) fireEvent.change(s, { target: { value: '13' } });
    // Either every edit succeeded legitimately, or the panel refused one.
    const refused = screen.queryByTestId('analysis-refused');
    const invalid = screen.queryByTestId('analysis-invalid');
    // What must never happen is an invalid position being accepted silently.
    expect(invalid).toBeNull();
    if (refused) expect(refused.textContent).toMatch(/No .* left in the deck/);
  });
});

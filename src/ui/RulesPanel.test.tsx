import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RulesPanel } from './RulesPanel';

describe('RulesPanel', () => {
  it('covers the parts of the game a player has to know', () => {
    render(<RulesPanel onClose={vi.fn()} />);
    const text = screen.getByTestId('rules-panel').textContent ?? '';
    // The turn, the wave, the once-per-turn lock, scoring, and the round end.
    expect(text).toMatch(/discard/i);
    expect(text).toMatch(/wave/i);
    expect(text).toMatch(/once per turn/i);
    expect(text).toMatch(/7, 11 and Skip-Bo/i);
    expect(text).toMatch(/2×2 square/i);
    expect(text).toMatch(/final turn/i);
  });

  it('states the scoring specials and the square bonus correctly', () => {
    render(<RulesPanel onClose={vi.fn()} />);
    const text = screen.getByTestId('rules-panel').textContent ?? '';
    expect(text).toMatch(/count as 0/i);
    expect(text).toMatch(/takes off 10/i);
    expect(text).toMatch(/left to right/i);
  });

  it('closes', () => {
    const onClose = vi.fn();
    render(<RulesPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Got it/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

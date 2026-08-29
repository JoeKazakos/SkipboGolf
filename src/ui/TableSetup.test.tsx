import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PRESETS, ROSTER, presetById } from '../ai/roster';
import { TableSetup } from './TableSetup';

describe('TableSetup', () => {
  it('starts on the default preset and deals those five seats', async () => {
    const onStart = vi.fn();
    render(<TableSetup onStart={onStart} />);

    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0]).toEqual([...presetById('club').seats]);
  });

  it('applies a preset to all five seats', async () => {
    const onStart = vi.fn();
    render(<TableSetup onStart={onStart} />);

    const tough = PRESETS.find((p) => p.id === 'tough')!;
    await userEvent.click(screen.getByRole('button', { name: new RegExp(tough.name) }));
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    expect(onStart.mock.calls[0][0]).toEqual([...tough.seats]);
  });

  it('lets one seat be overridden without disturbing the others', async () => {
    const onStart = vi.fn();
    render(<TableSetup onStart={onStart} />);

    await userEvent.selectOptions(screen.getByLabelText('Opponent in seat 3'), 'sage');
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    const base = [...presetById('club').seats];
    const expected = [...base];
    expected[2] = 'sage';
    expect(onStart.mock.calls[0][0]).toEqual(expected);
  });

  it('offers every roster profile in each seat', () => {
    render(<TableSetup onStart={vi.fn()} />);
    const select = screen.getByLabelText('Opponent in seat 1');
    const options = within(select).getAllByRole('option').map((o) => o.textContent ?? '');
    for (const profile of ROSTER) {
      expect(options.some((text) => text.startsWith(profile.name))).toBe(true);
    }
  });

  it('shows a strength word for each seat, not a raw rating', () => {
    render(<TableSetup onStart={vi.fn()} />);
    const seats = screen.getAllByRole('listitem');
    expect(seats).toHaveLength(5);
    for (const seat of seats) {
      const profileId = (within(seat).getByRole('combobox') as HTMLSelectElement).value;
      const profile = ROSTER.find((p) => p.id === profileId)!;
      // The tier word appears in the row...
      expect(within(seat).getAllByText(profile.tier).length).toBeGreaterThan(0);
      // ...and the Elo number does not.
      if (profile.elo != null) {
        expect(within(seat).queryByText(String(profile.elo))).toBeNull();
      }
    }
  });

  it('keeps the exact ratings available in the details panel', () => {
    render(<TableSetup onStart={vi.fn()} />);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    for (const profile of ROSTER) {
      const row = rows.find(
        (r) => within(r).queryByRole('rowheader')?.textContent === profile.name,
      );
      expect(row, `no ladder row for ${profile.name}`).toBeTruthy();
      if (profile.elo != null) {
        expect(within(row!).getByText(String(profile.elo))).toBeTruthy();
      }
    }
  });

  it('says "unrated" rather than inventing a number for an unmeasured profile', () => {
    render(<TableSetup onStart={vi.fn()} />);
    const unrated = ROSTER.filter((p) => p.elo == null).length;
    // Every seat showing an unmeasured profile must say so explicitly.
    if (unrated > 0) {
      expect(screen.getAllByText('unrated').length).toBeGreaterThan(0);
    }
    // And no seat may show a rating for a profile that has none.
    for (const profile of ROSTER) {
      if (profile.elo == null) {
        expect(screen.queryByText(String(profile.elo))).toBeNull();
      }
    }
  });
});

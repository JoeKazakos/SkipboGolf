import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPPONENTS, DEFAULT_PRESET_ID, PRESETS, ROSTER, presetSeats } from '../ai/roster';
import { TableSetup } from './TableSetup';
import { ProfilesProvider } from './ProfilesContext';

/** TableSetup reads the player profiles, so it needs the provider. */
function renderSetup(props: Parameters<typeof TableSetup>[0]) {
  return render(
    <ProfilesProvider>
      <TableSetup {...props} />
    </ProfilesProvider>,
  );
}

describe('TableSetup', () => {
  it('starts on the default preset and deals those seats', async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0]).toEqual(presetSeats(DEFAULT_PRESET_ID, DEFAULT_OPPONENTS));
  });

  it('applies a preset to every seat', async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    const tough = PRESETS.find((p) => p.id === 'tough')!;
    await userEvent.click(screen.getByRole('button', { name: new RegExp(tough.name) }));
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    expect(onStart.mock.calls[0][0]).toEqual(presetSeats(tough.id, DEFAULT_OPPONENTS));
  });

  it('lets one seat be overridden without disturbing the others', async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    await userEvent.selectOptions(screen.getByLabelText('Opponent in seat 3'), 'sage');
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    const expected = presetSeats(DEFAULT_PRESET_ID, DEFAULT_OPPONENTS);
    expected[2] = 'sage';
    expect(onStart.mock.calls[0][0]).toEqual(expected);
  });

  it('deals the chosen number of opponents', async () => {
    for (const n of [1, 3, 6]) {
      const onStart = vi.fn();
      const { unmount } = renderSetup({ onStart });
      await userEvent.click(screen.getByRole('button', { name: `${n} opponent${n === 1 ? '' : 's'}` }));
      await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));
      expect(onStart.mock.calls[0][0]).toHaveLength(n);
      unmount();
    }
  });

  it('keeps seats already chosen when the table grows', async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    await userEvent.selectOptions(screen.getByLabelText('Opponent in seat 1'), 'sage');
    await userEvent.click(screen.getByRole('button', { name: '6 opponents' }));
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    const seats = onStart.mock.calls[0][0];
    expect(seats).toHaveLength(6);
    // Growing the table must not discard the override already made.
    expect(seats[0]).toBe('sage');
  });

  it('shrinking the table drops seats from the end only', async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    const before = presetSeats(DEFAULT_PRESET_ID, DEFAULT_OPPONENTS);
    await userEvent.click(screen.getByRole('button', { name: '2 opponents' }));
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));

    expect(onStart.mock.calls[0][0]).toEqual(before.slice(0, 2));
  });

  it('offers every roster profile in each seat', () => {
    renderSetup({ onStart: vi.fn() });
    const select = screen.getByLabelText('Opponent in seat 1');
    const options = within(select).getAllByRole('option').map((o) => o.textContent ?? '');
    for (const profile of ROSTER) {
      expect(options.some((text) => text.startsWith(profile.name))).toBe(true);
    }
  });

  it('shows a strength word for each seat, not a raw rating', () => {
    renderSetup({ onStart: vi.fn() });
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
    renderSetup({ onStart: vi.fn() });
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
    renderSetup({ onStart: vi.fn() });
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

describe('preset descriptions follow the table size', () => {
  it('updates the gauntlet text when the opponent count changes', async () => {
    renderSetup({ onStart: vi.fn() });
    const gauntlet = () =>
      screen.getByRole('button', { name: /The gauntlet/ }).textContent ?? '';

    // Default table.
    expect(gauntlet()).toMatch(new RegExp(`${DEFAULT_OPPONENTS} best`));

    await userEvent.click(screen.getByRole('button', { name: '3 opponents' }));
    expect(gauntlet()).toMatch(/3 best/);
    expect(gauntlet()).not.toMatch(new RegExp(`${DEFAULT_OPPONENTS} best`));

    await userEvent.click(screen.getByRole('button', { name: '1 opponent' }));
    // Reads naturally at one rather than saying "the 1 best".
    expect(gauntlet()).toMatch(/best there is/);
  });

  it('never states a count that disagrees with the table', async () => {
    renderSetup({ onStart: vi.fn() });
    for (const n of [1, 2, 4, 6]) {
      await userEvent.click(
        screen.getByRole('button', { name: `${n} opponent${n === 1 ? '' : 's'}` }),
      );
      for (const preset of PRESETS) {
        const text = screen.getByRole('button', { name: new RegExp(preset.name) }).textContent ?? '';
        // Any number in a preset description must be the current count.
        for (const found of text.matchAll(/\b(\d+)\b/g)) {
          expect(Number(found[1])).toBe(n);
        }
      }
    }
  });
});

describe('the default table', () => {
  it('is the gauntlet, since most players are already good', async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });
    await userEvent.click(screen.getByRole('button', { name: /Deal the round/ }));
    expect(onStart.mock.calls[0][0]).toEqual(presetSeats('gauntlet', DEFAULT_OPPONENTS));
  });
});

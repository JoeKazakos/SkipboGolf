import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { applyAction, createInitialState, isWaveLegal, legalActions, returns } from '../engine/state';
import { makeRng } from '../engine/rng';
import type { Action, GameState } from '../engine/types';
import type { Agent } from '../ai/agent';
import { HUMAN, playerName, spotName } from './format';

/** An opponent that never decides, so the board stays still while we assert. */
const idleAgent: Agent = {
  name: 'idle',
  chooseAction: () => new Promise<Action>(() => {}),
};

/** A hint advisor that deterministically suggests the first legal action. */
const firstLegalAgent: Agent = {
  name: 'first-legal',
  chooseAction: async (state) => legalActions(state)[0],
};

/**
 * Finds a deal in which the human can draw the center card, place it somewhere,
 * and then have a legal wave available — the full turn shape the UI must
 * support. Derived from the engine so the test never hard-codes a board.
 */
function findWaveScenario(): { seed: number; spot: number; wave: number } {
  for (let seed = 1; seed < 3000; seed++) {
    const s0 = createInitialState(seed);
    if (s0.current !== HUMAN) continue;
    const drawn = applyAction(s0, { type: 'draw', source: { kind: 'center' } });
    for (let spot = 0; spot < 10; spot++) {
      const placed = applyAction(drawn, { type: 'place', spot });
      for (let w = 0; w < 10; w++) {
        if (isWaveLegal(placed, w)) return { seed, spot, wave: w };
      }
    }
  }
  throw new Error('no wave scenario found in the searched seeds');
}

/** Plays a whole round with seeded-random legal moves to reach a terminal state. */
function playToTerminal(seed: number): GameState {
  const rng = makeRng(seed);
  let s = createInitialState(seed);
  for (let i = 0; i < 50000 && !s.terminal; i++) {
    const actions = legalActions(s);
    s = applyAction(s, actions[Math.floor(rng.next() * actions.length)]);
  }
  if (!s.terminal) throw new Error('playout did not terminate');
  return s;
}

const spotButton = (i: number) =>
  screen.getByRole('button', { name: new RegExp(`^${spotName(i)},`) });

describe('a complete human turn', () => {
  it('draws, places, waves and discards', async () => {
    const { seed, spot, wave } = findWaveScenario();
    render(<App seed={seed} agent={idleAgent} hintAgent={firstLegalAgent} aiDelayMs={0} />);

    // --- draw phase
    expect(screen.getByTestId('turn-banner').textContent).toMatch(/Your turn/);
    expect(screen.getByTestId('phase-badge').textContent).toMatch(/Draw/);

    const center = screen.getByRole('button', { name: /Draw the center card/ });
    const centerRank = Number(center.querySelector('[data-rank]')?.getAttribute('data-rank'));
    expect(Number.isFinite(centerRank)).toBe(true);
    fireEvent.click(center);

    // --- act phase, holding the center card
    expect(screen.getByTestId('phase-badge').textContent).toMatch(/Act/);
    expect(document.querySelector('.card--held')?.getAttribute('data-rank')).toBe(
      String(centerRank),
    );

    // --- first placement: any unlocked spot is legal
    fireEvent.click(spotButton(spot));
    const placed = spotButton(spot);
    expect(placed.querySelector('[data-rank]')?.getAttribute('data-rank')).toBe(String(centerRank));
    expect(placed.getAttribute('data-locked')).toBe('true');

    // --- wave
    const waveBtn = spotButton(wave);
    expect((waveBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(waveBtn);
    expect(spotButton(wave).getAttribute('data-locked')).toBe('true');

    const log = screen.getByTestId('action-log');
    expect(log.textContent).toMatch(/You wave the/);

    // --- discard ends the turn and passes play on
    fireEvent.click(screen.getByRole('button', { name: /Discard & end turn/ }));
    expect(log.textContent).toMatch(/Turn over/);
    await waitFor(() =>
      expect(screen.getByTestId('turn-banner').textContent).toBe(`${playerName(1)} is playing`),
    );
  });
});

describe('placement legality in the DOM', () => {
  it('offers every spot on the first placement and only legal waves afterwards', () => {
    const { seed, spot } = findWaveScenario();
    render(<App seed={seed} agent={idleAgent} aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Draw the center card/ }));

    // First placement: all ten spots enabled (section 15.11 step 2).
    for (let i = 0; i < 10; i++) {
      expect((spotButton(i) as HTMLButtonElement).disabled).toBe(false);
    }

    fireEvent.click(spotButton(spot));

    // Afterwards the DOM must agree exactly with the engine.
    const engine = createInitialState(seed);
    const after = applyAction(
      applyAction(engine, { type: 'draw', source: { kind: 'center' } }),
      { type: 'place', spot },
    );
    const legalSpots = new Set(
      legalActions(after)
        .filter((a): a is Extract<Action, { type: 'place' }> => a.type === 'place')
        .map((a) => a.spot),
    );

    for (let i = 0; i < 10; i++) {
      const btn = spotButton(i) as HTMLButtonElement;
      expect(btn.disabled).toBe(!legalSpots.has(i));
      expect(btn.getAttribute('data-legal')).toBe(legalSpots.has(i) ? 'true' : 'false');
    }
    // The wave rule really does exclude most of the board.
    expect(legalSpots.size).toBeLessThan(10);
  });

  it('locks a spot after it has been played into once', () => {
    const { seed, spot } = findWaveScenario();
    render(<App seed={seed} agent={idleAgent} aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Draw the center card/ }));
    fireEvent.click(spotButton(spot));

    const locked = spotButton(spot) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(locked.getAttribute('data-locked')).toBe('true');
    expect(locked.getAttribute('aria-label')).toMatch(/locked/);

    const rankBefore = locked.querySelector('[data-rank]')?.getAttribute('data-rank');
    const heldBefore = document.querySelector('.card--held')?.getAttribute('data-rank');

    fireEvent.click(locked); // rejected: the spot is spent for this turn

    expect(spotButton(spot).querySelector('[data-rank]')?.getAttribute('data-rank')).toBe(
      rankBefore,
    );
    expect(document.querySelector('.card--held')?.getAttribute('data-rank')).toBe(heldBefore);
  });
});

describe('hidden information', () => {
  it('never renders a rank for a face-down card', () => {
    const seed = 42;
    render(<App seed={seed} agent={idleAgent} aiDelayMs={0} />);
    const state = createInitialState(seed);

    for (let p = 1; p < 6; p++) {
      const grid = screen.getByRole('group', { name: `${playerName(p)}'s ten cards` });
      const backs = grid.querySelectorAll('[data-facedown="true"]');
      const faces = grid.querySelectorAll('[data-rank]');
      const faceUpCount = state.players[p].grid.filter((s) => s.faceUp).length;

      expect(backs.length).toBe(10 - faceUpCount);
      expect(faces.length).toBe(faceUpCount);

      // The ranks that ARE shown are exactly the ones the engine calls face up.
      const shown = [...faces].map((el) => Number(el.getAttribute('data-rank'))).sort();
      const expected = state.players[p].grid
        .filter((s) => s.faceUp)
        .map((s) => s.card.rank as number)
        .sort();
      expect(shown).toEqual(expected);
    }

    // Globally: no face-down card carries a rank or any text at all.
    for (const back of document.querySelectorAll('[data-facedown="true"]')) {
      expect(back.hasAttribute('data-rank')).toBe(false);
      expect(back.textContent).toBe('');
    }
    // Including the human's own seven face-down cards.
    const mine = screen.getByRole('group', { name: 'Your ten cards' });
    expect(mine.querySelectorAll('[data-facedown="true"]').length).toBe(7);
  });
});

describe('the opponent driver', () => {
  it('plays all five opponents through and hands the turn back', async () => {
    // Start the position just after the human has finished a turn.
    let s = createInitialState(11);
    s = applyAction(s, { type: 'draw', source: { kind: 'pile' } });
    s = applyAction(s, { type: 'discard' });
    expect(s.current).toBe(1);

    render(<App initialState={s} agent={firstLegalAgent} aiDelayMs={0} />);

    expect(screen.getByTestId('turn-banner').textContent).toBe(`${playerName(1)} is playing`);
    await waitFor(
      () => expect(screen.getByTestId('turn-banner').textContent).toMatch(/Your turn/),
      { timeout: 4000 },
    );

    // Every opponent's move is narrated, without naming a private card.
    const log = screen.getByTestId('action-log').textContent ?? '';
    for (let p = 1; p < 6; p++) expect(log).toContain(playerName(p));
  });
});

describe('the hint button', () => {
  it('surfaces a suggestion for the human position', async () => {
    render(<App seed={5} agent={idleAgent} hintAgent={firstLegalAgent} aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    await waitFor(() => expect(screen.getByTestId('hint-text')).toBeTruthy());
    expect(screen.getByTestId('hint-text').textContent).toMatch(/Take|Draw|Place|Wave|Discard/);
  });
});

describe('game over', () => {
  it('shows six final scores and names the winner', () => {
    const terminal = playToTerminal(9);
    render(<App initialState={terminal} agent={idleAgent} aiDelayMs={0} />);

    const dialog = screen.getByRole('dialog', { name: 'Round over' });
    const rows = within(dialog).getAllByTestId('final-score');
    expect(rows).toHaveLength(6);

    const scores = returns(terminal);
    const shown = rows.map((r) => ({
      player: Number(r.getAttribute('data-player')),
      score: Number(r.getAttribute('data-score')),
    }));
    for (const { player, score } of shown) expect(score).toBe(scores[player]);

    const best = Math.min(...scores);
    const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    const winnerText = screen.getByTestId('winner').textContent ?? '';
    for (const w of winners) expect(winnerText).toContain(playerName(w));
    expect(winnerText).toContain(String(best));
  });
});

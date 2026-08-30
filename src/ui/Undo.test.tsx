import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import type { Agent } from '../ai/agent';

const idleAgent: Agent = {
  name: 'idle',
  chooseAction: () => new Promise<Action>(() => {}),
};

/** A deal where it is the human's turn to draw. */
function humanToPlay(seed = 1): GameState {
  const s = createInitialState(seed);
  expect(s.current).toBe(0);
  return s;
}

const undoBtn = () => screen.getByRole('button', { name: /Undo turn/i }) as HTMLButtonElement;
const discardBtn = () => screen.getByRole('button', { name: /Discard & end turn/i });

/** The human's ten grid cards, as rank strings, with 'down' for a hidden one. */
function humanGrid(): string {
  return [...document.querySelectorAll('.seat--human .grid--lg .card')]
    .map((el) => el.getAttribute('data-rank') ?? 'down')
    .join(',');
}

describe('undo', () => {
  it('is disabled before the turn has begun', () => {
    render(<App initialState={humanToPlay()} agent={idleAgent} aiDelayMs={0} />);
    expect(undoBtn().disabled).toBe(true);
  });

  it('restores the board after a draw and a placement', async () => {
    render(<App initialState={humanToPlay()} agent={idleAgent} aiDelayMs={0} />);

    const gridBefore = humanGrid();

    fireEvent.click(screen.getByLabelText(/^Draw the center card/));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: /play here/ })[0]);

    const gridDuring = humanGrid();
    expect(gridDuring).not.toBe(gridBefore);

    fireEvent.click(undoBtn());

    await waitFor(() => {
      expect(humanGrid()).toBe(gridBefore);
    });
    expect(undoBtn().disabled).toBe(true);
  });

  it('rolls the action log back with the board', async () => {
    render(<App initialState={humanToPlay()} agent={idleAgent} aiDelayMs={0} />);
    const logText = () => screen.getByTestId('action-log').textContent ?? '';
    const before = logText();

    fireEvent.click(screen.getByLabelText(/^Draw the center card/));
    await waitFor(() => expect(logText()).not.toBe(before));

    fireEvent.click(undoBtn());
    await waitFor(() => expect(logText()).toBe(before));
  });

  it('is no longer offered once the turn has been committed by discarding', async () => {
    render(<App initialState={humanToPlay()} agent={idleAgent} aiDelayMs={0} />);
    fireEvent.click(screen.getByLabelText(/^Draw the center card/));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
    fireEvent.click(discardBtn());
    // The turn has passed to an opponent, so there is nothing to take back.
    await waitFor(() => expect(undoBtn().disabled).toBe(true));
  });

  it('leaves the engine in a state that still accepts legal play', async () => {
    const start = humanToPlay();
    render(<App initialState={start} agent={idleAgent} aiDelayMs={0} />);
    fireEvent.click(screen.getByLabelText(/^Draw the center card/));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
    fireEvent.click(undoBtn());
    // Drawing again must work: the restored position is a real position.
    await waitFor(() => expect((screen.getByLabelText(/^Draw the center card/) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByLabelText(/^Draw the center card/));
    await waitFor(() => expect(undoBtn().disabled).toBe(false));
  });
});

describe('undo snapshot invariants', () => {
  it('the engine really is immutable, which is what makes undo safe', () => {
    const s = createInitialState(9);
    const before = JSON.stringify(s);
    applyAction(s, legalActions(s)[0]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

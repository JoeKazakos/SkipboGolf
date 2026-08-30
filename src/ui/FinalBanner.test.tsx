import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import type { Agent } from '../ai/agent';

const idleAgent: Agent = { name: 'idle', chooseAction: () => new Promise<Action>(() => {}) };

/**
 * A state in the final cycle where it is the human's turn AND the table is
 * still owed more than one turn - which is exactly the case the old wording
 * got wrong.
 */
function finalCycleHumanToPlay(minTableTurns = 1): GameState {
  for (let seed = 1; seed < 2000; seed++) {
    let s = createInitialState(seed);
    let guard = 0;
    while (!s.terminal && guard < 4000) {
      if (
        s.triggerPlayer !== null &&
        s.current === 0 &&
        s.phase === 'draw' &&
        (s.finalTurnsRemaining ?? 0) >= minTableTurns
      ) {
        return s;
      }
      const a = legalActions(s);
      s = applyAction(s, a[guard % a.length]);
      guard++;
    }
  }
  throw new Error('no such position found');
}

describe('final turn banner', () => {
  it("counts the player's own turn, not the whole table's", () => {
    const s = finalCycleHumanToPlay(2);
    // The table is owed several turns; the player is owed exactly one.
    expect(s.finalTurnsRemaining).toBeGreaterThan(1);

    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    const text = screen.getByTestId('final-banner').textContent ?? '';

    expect(text).toMatch(/one final turn/i);
    // The old wording leaked the table total, which read as "5 final turns".
    expect(text).not.toMatch(new RegExp(`${s.finalTurnsRemaining}\s*final turns`, 'i'));
  });

  it('names who closed the round', () => {
    const s = finalCycleHumanToPlay();
    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    expect(screen.getByTestId('final-banner').textContent).toMatch(/closed the round/i);
  });

  it('says the player is waiting once their own final turn is done', () => {
    let s = finalCycleHumanToPlay();
    // Play the human's final turn out.
    let guard = 0;
    while (!s.terminal && s.current === 0 && guard < 60) {
      const a = legalActions(s);
      const discard = a.find((x) => x.type === 'discard');
      s = applyAction(s, discard ?? a[0]);
      guard++;
    }
    if (s.terminal) return; // nothing to assert; the round ended immediately

    render(<App initialState={s} agent={idleAgent} aiDelayMs={0} />);
    const text = screen.getByTestId('final-banner').textContent ?? '';
    expect(text).toMatch(/final turn is done/i);
    expect(text).toMatch(/waiting on \d+ more player/i);
  });
});

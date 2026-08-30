import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, legalActions, stillToActInFinalCycle } from './state';
import type { GameState } from './types';

/** Plays until someone triggers the round end, then returns that state. */
function atTrigger(): GameState {
  for (let seed = 1; seed < 400; seed++) {
    let s = createInitialState(seed);
    let guard = 0;
    while (!s.terminal && guard < 4000) {
      if (s.triggerPlayer !== null) return s;
      const a = legalActions(s);
      s = applyAction(s, a[guard % a.length]);
      guard++;
    }
  }
  throw new Error('no trigger found');
}

describe('stillToActInFinalCycle', () => {
  it('is false before anyone has gone out', () => {
    const s = createInitialState(4);
    for (let p = 0; p < s.players.length; p++) {
      expect(stillToActInFinalCycle(s, p)).toBe(false);
    }
  });

  it('owes a turn to everyone except the player who went out', () => {
    const s = atTrigger();
    const trigger = s.triggerPlayer as number;
    expect(stillToActInFinalCycle(s, trigger)).toBe(false);
    for (let p = 0; p < s.players.length; p++) {
      if (p === trigger) continue;
      expect(stillToActInFinalCycle(s, p), `player ${p}`).toBe(true);
    }
  });

  it('owes exactly one turn each, however many players remain', () => {
    let s = atTrigger();
    const owed = () =>
      s.players.map((_, p) => stillToActInFinalCycle(s, p)).filter(Boolean).length;
    expect(owed()).toBe(s.finalTurnsRemaining);

    // Play one turn: exactly one player drops out of the owed set.
    const before = owed();
    let guard = 0;
    const actor = s.current;
    while (!s.terminal && s.current === actor && guard < 100) {
      const a = legalActions(s);
      s = applyAction(s, a[guard % a.length]);
      guard++;
    }
    if (!s.terminal) {
      expect(owed()).toBe(before - 1);
      expect(stillToActInFinalCycle(s, actor)).toBe(false);
    }
  });

  it('owes nobody a turn once the round is over', () => {
    let s = atTrigger();
    let guard = 0;
    while (!s.terminal && guard < 4000) {
      const a = legalActions(s);
      s = applyAction(s, a[guard % a.length]);
      guard++;
    }
    expect(s.terminal).toBe(true);
    for (let p = 0; p < s.players.length; p++) {
      expect(stillToActInFinalCycle(s, p)).toBe(false);
    }
  });
});

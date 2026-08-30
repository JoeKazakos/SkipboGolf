import { describe, expect, it, beforeEach } from 'vitest';
import { applyAction, createInitialState, legalActions } from '../engine/state';
import { newMatch } from './match';
import { clearGame, isRestorable, loadGame, saveGame } from './persistence';

const seats = ['pip', 'nel'];

function saved() {
  let game = createInitialState(77, seats.length + 1);
  game = applyAction(game, legalActions(game)[0]);
  return { seats: [...seats], seed: 77, game, match: newMatch(3, seats.length + 1) };
}

beforeEach(() => localStorage.clear());

describe('saving a game', () => {
  it('round-trips a position exactly', () => {
    const s = saved();
    saveGame(s);
    const back = loadGame();
    expect(back).not.toBeNull();
    expect(back!.game).toEqual(s.game);
    expect(back!.seats).toEqual(s.seats);
    expect(back!.match.rounds).toBe(3);
  });

  it('returns null when nothing is stored', () => {
    expect(loadGame()).toBeNull();
  });

  it('discards a blob from a different version', () => {
    const s = saved();
    saveGame(s);
    const raw = JSON.parse(localStorage.getItem('skipbo-golf.game.v1')!);
    raw.version = 99;
    localStorage.setItem('skipbo-golf.game.v1', JSON.stringify(raw));
    expect(loadGame()).toBeNull();
  });

  it('discards malformed JSON rather than throwing', () => {
    localStorage.setItem('skipbo-golf.game.v1', '{not json');
    expect(loadGame()).toBeNull();
  });

  it('rejects a position whose cards do not add up', () => {
    const s = saved();
    // Lose a card: the position is no longer playable.
    s.game.drawPile = s.game.drawPile.slice(1);
    saveGame(s);
    expect(loadGame()).toBeNull();
  });

  it('rejects a save whose seat count disagrees with the players', () => {
    const s = saved();
    saveGame({ ...s, seats: ['pip'] });
    expect(loadGame()).toBeNull();
  });

  it('clears on request', () => {
    saveGame(saved());
    expect(loadGame()).not.toBeNull();
    clearGame();
    expect(loadGame()).toBeNull();
  });
});

describe('isRestorable', () => {
  it('rejects obvious rubbish without throwing', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { version: 1 }, []]) {
      expect(isRestorable(bad)).toBe(false);
    }
  });

  it('accepts a genuine save', () => {
    const s = saved();
    expect(isRestorable({ ...s, version: 1, savedAt: Date.now() })).toBe(true);
  });
});

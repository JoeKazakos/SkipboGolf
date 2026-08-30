import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, legalActions, observationFor } from './state';
import type { Action, GameState } from './types';

/** Applies the first legal action of the given type. */
function act(s: GameState, pick: (a: Action) => boolean): GameState {
  const a = legalActions(s).find(pick);
  if (!a) throw new Error('no matching legal action');
  return applyAction(s, a);
}

describe('heldIsPublic', () => {
  it('is true after taking the centre card', () => {
    const s = createInitialState(11);
    const after = act(s, (a) => a.type === 'draw' && a.source.kind === 'center');
    expect(after.heldIsPublic).toBe(true);
    expect(after.held).not.toBeNull();
  });

  it('is false after drawing blind from the pile', () => {
    const s = createInitialState(11);
    const after = act(s, (a) => a.type === 'draw' && a.source.kind === 'pile');
    expect(after.heldIsPublic).toBe(false);
  });

  it('is true after taking another player\'s discard top', () => {
    // Give player 1 a discard to take from: player 0 plays a full turn first.
    let s = createInitialState(21);
    s = act(s, (a) => a.type === 'draw' && a.source.kind === 'pile');
    s = act(s, (a) => a.type === 'discard');
    expect(s.current).toBe(1);
    const after = act(s, (a) => a.type === 'draw' && a.source.kind === 'discard');
    expect(after.heldIsPublic).toBe(true);
  });

  it('follows the spot when a placement displaces a card', () => {
    let s = createInitialState(33);
    s = act(s, (a) => a.type === 'draw' && a.source.kind === 'center');

    // Placing into a face-DOWN spot yields a card only the placer has seen.
    const faceDown = s.players[s.current].grid.findIndex((slot) => !slot.faceUp);
    const afterHidden = applyAction(s, { type: 'place', spot: faceDown });
    expect(afterHidden.heldIsPublic).toBe(false);

    // Placing into a face-UP spot yields a card everyone had already seen.
    const faceUp = s.players[s.current].grid.findIndex((slot) => slot.faceUp);
    const afterVisible = applyAction(s, { type: 'place', spot: faceUp });
    expect(afterVisible.heldIsPublic).toBe(true);
  });
});

describe('observationFor heldByCurrent', () => {
  it('is null when nobody holds anything', () => {
    const s = createInitialState(5);
    expect(observationFor(s, 3).heldByCurrent).toBeNull();
  });

  it('shows the rank to everyone when the draw was public', () => {
    const s = createInitialState(7);
    const after = act(s, (a) => a.type === 'draw' && a.source.kind === 'center');
    for (let viewer = 0; viewer < after.players.length; viewer++) {
      expect(observationFor(after, viewer).heldByCurrent?.card?.rank).toBe(after.held?.rank);
    }
  });

  it('hides the rank from others when the draw was blind', () => {
    const s = createInitialState(7);
    const after = act(s, (a) => a.type === 'draw' && a.source.kind === 'pile');
    // The drawer sees it.
    expect(observationFor(after, after.current).heldByCurrent?.card?.rank).toBe(after.held?.rank);
    // Nobody else does, but they can tell someone is holding something.
    for (let viewer = 0; viewer < after.players.length; viewer++) {
      if (viewer === after.current) continue;
      const hc = observationFor(after, viewer).heldByCurrent;
      expect(hc).not.toBeNull();
      expect(hc?.card).toBeNull();
    }
  });
});

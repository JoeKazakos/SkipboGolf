import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, isTerminal, legalActions } from '../../engine/state';
import { makeRng } from '../../engine/rng';
import type { GameState } from '../../engine/types';
import {
  decodePosition,
  decodePositionAt,
  encodePosition,
  encodedLength,
} from './positions';

/**
 * Self-play data is only as good as this round-trip. A field that silently
 * fails to survive - a card id, a discard order, the rng state - would not
 * crash anything; it would just train the network on positions that never
 * occurred, and nothing downstream would notice.
 */

function walk(seed: number, players: number, steps: number): GameState[] {
  const rng = makeRng(seed);
  let s = createInitialState(seed, players);
  const seen: GameState[] = [s];
  for (let i = 0; i < steps && !isTerminal(s); i++) {
    const acts = legalActions(s);
    s = applyAction(s, acts[Math.floor(rng.next() * acts.length)]);
    seen.push(s);
  }
  return seen;
}

describe('position serialisation', () => {
  it('round-trips exactly at every table size and every stage', () => {
    let checked = 0;
    for (let players = 2; players <= 7; players++) {
      for (const seed of [11, 2029, 77771]) {
        for (const s of walk(seed + players, players, 260)) {
          const back = decodePosition(encodePosition(s));
          expect(back).toEqual(s);
          checked++;
        }
      }
    }
    // A guard against the loops silently collapsing to nothing.
    expect(checked).toBeGreaterThan(2000);
  });

  it('preserves the fields that are easiest to lose', () => {
    for (const s of walk(4242, 5, 300)) {
      const back = decodePosition(encodePosition(s));
      // Card identity, not just rank: determinization re-pairs ids with ranks,
      // so an id that does not survive would corrupt the unseen-card census.
      for (let p = 0; p < s.players.length; p++) {
        for (let i = 0; i < s.players[p].grid.length; i++) {
          expect(back.players[p].grid[i].card.id).toBe(s.players[p].grid[i].card.id);
          expect(back.players[p].grid[i].faceUp).toBe(s.players[p].grid[i].faceUp);
        }
        expect(back.players[p].discard.map((c) => c.id)).toEqual(
          s.players[p].discard.map((c) => c.id),
        );
      }
      expect(back.drawPile.map((c) => c.id)).toEqual(s.drawPile.map((c) => c.id));
      expect(back.rngState).toBe(s.rngState);
      expect(back.heldIsPublic).toBe(s.heldIsPublic);
      expect(back.locked).toEqual(s.locked);
      expect(back.finalTurnsRemaining).toBe(s.finalTurnsRemaining);
      expect(back.triggerPlayer).toBe(s.triggerPlayer);
    }
  });

  it('a decoded position is still playable', () => {
    // The point of storing positions is that they can be searched later, so a
    // decoded one has to behave, not merely compare equal.
    for (const s of walk(909, 4, 120)) {
      if (isTerminal(s)) continue;
      const back = decodePosition(encodePosition(s));
      expect(legalActions(back).map((a) => JSON.stringify(a))).toEqual(
        legalActions(s).map((a) => JSON.stringify(a)),
      );
      const action = legalActions(s)[0];
      expect(applyAction(back, action)).toEqual(applyAction(s, action));
    }
  });

  it('reports a length that matches what it writes', () => {
    for (const s of walk(31337, 6, 150)) {
      expect(encodedLength(s)).toBe(encodePosition(s).length);
    }
  });

  it('walks a concatenated stream of positions', () => {
    const states = walk(5150, 3, 80);
    const parts = states.map(encodePosition);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const stream = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      stream.set(p, at);
      at += p.length;
    }

    let offset = 0;
    for (const original of states) {
      const { state, next } = decodePositionAt(stream, offset);
      expect(state).toEqual(original);
      offset = next;
    }
    expect(offset).toBe(total);
  });

  it('refuses a truncated record rather than returning a partial position', () => {
    const s = walk(6, 4, 40)[20];
    const bytes = encodePosition(s);
    expect(() => decodePosition(bytes.slice(0, bytes.length - 5))).toThrow(/truncated/i);
  });

  it('refuses an unknown format version', () => {
    const bytes = encodePosition(walk(7, 3, 10)[5]);
    bytes[0] = 99;
    expect(() => decodePosition(bytes)).toThrow(/version/i);
  });
});

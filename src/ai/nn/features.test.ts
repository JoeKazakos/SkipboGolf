import { describe, expect, it } from 'vitest';
import { makeRng } from '../../engine/rng';
import { applyAction, createInitialState, legalActions } from '../../engine/state';
import type { GameState } from '../../engine/types';
import { determinize } from '../ismcts';
import { FEATURE_SIZE, encodeFeatures } from './features';

/**
 * Positions spread across the whole round: fresh deals, mid-round grids with
 * discard piles deep enough that cards have gone out of sight, and end-game
 * positions inside the final turn cycle. The leak the invariance test hunts for
 * only exists where there is hidden information to leak, so the sample has to
 * cover the states where there is plenty.
 */
function playForward(seed: number, numPlayers: number, steps: number): GameState {
  const rng = makeRng(seed ^ 0x9e3779b9);
  let s = createInitialState(seed, numPlayers);
  for (let i = 0; i < steps; i++) {
    if (s.terminal) break;
    const actions = legalActions(s);
    if (actions.length === 0) break;
    s = applyAction(s, actions[Math.floor(rng.next() * actions.length)]);
  }
  return s;
}

/**
 * True when the determinized world genuinely re-dealt something hidden. Without
 * this the invariance test could pass vacuously on positions where there was
 * nothing left to scramble.
 */
function hiddenCardsDiffer(a: GameState, b: GameState): boolean {
  for (let p = 0; p < a.players.length; p++) {
    const ga = a.players[p].grid;
    const gb = b.players[p].grid;
    for (let i = 0; i < ga.length; i++) {
      if (!ga[i].faceUp && ga[i].card.rank !== gb[i].card.rank) return true;
    }
    const da = a.players[p].discard;
    const db = b.players[p].discard;
    for (let i = 0; i < da.length - 3; i++) if (da[i].rank !== db[i].rank) return true;
  }
  for (let i = 0; i < a.drawPile.length; i++) {
    if (a.drawPile[i].rank !== b.drawPile[i].rank) return true;
  }
  return false;
}

/** A spread of table sizes and round stages, as one flat list. */
function samplePositions(): { s: GameState; label: string }[] {
  const out: { s: GameState; label: string }[] = [];
  let seed = 1;
  for (let numPlayers = 2; numPlayers <= 7; numPlayers++) {
    for (const steps of [0, 1, 5, 17, 40, 120, 300, 900, 2500]) {
      for (let rep = 0; rep < 3; rep++) {
        seed += 1;
        out.push({
          s: playForward(seed * 7919, numPlayers, steps),
          label: `${numPlayers}p/${steps} steps/seed ${seed}`,
        });
      }
    }
  }
  return out;
}

describe('feature encoding', () => {
  it('produces exactly FEATURE_SIZE finite values', () => {
    expect(FEATURE_SIZE).toBeLessThanOrEqual(400);
    for (const { s, label } of samplePositions()) {
      for (let viewer = 0; viewer < s.players.length; viewer++) {
        const f = encodeFeatures(s, viewer);
        expect(f.length, label).toBe(FEATURE_SIZE);
        for (let i = 0; i < f.length; i++) {
          if (!Number.isFinite(f[i])) {
            throw new Error(`non-finite feature ${i} = ${f[i]} at ${label}, viewer ${viewer}`);
          }
          // Everything is normalised; a value outside this band is a bug in a
          // scale factor, and a scale factor that drifts wrecks training silently.
          expect(Math.abs(f[i]), `${label} feature ${i}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is invariant under determinization', () => {
    // The whole point: determinization keeps every card the viewer can see and
    // re-deals every card they cannot. An encoder that reads a face-down rank, a
    // buried discard, the draw pile's contents, a card id or an opponent's
    // private held card will differ here. This is mechanical proof of no leak.
    let checked = 0;
    let scrambled = 0;
    for (const { s, label } of samplePositions()) {
      for (let viewer = 0; viewer < s.players.length; viewer++) {
        const base = encodeFeatures(s, viewer);
        for (let trial = 0; trial < 4; trial++) {
          const rng = makeRng(0xc0ffee + trial * 104729 + viewer);
          const world = determinize(s, viewer, rng);
          if (hiddenCardsDiffer(s, world)) scrambled += 1;
          const shadow = encodeFeatures(world, viewer);
          for (let i = 0; i < FEATURE_SIZE; i++) {
            if (base[i] !== shadow[i]) {
              throw new Error(
                `feature ${i} leaks hidden information: ${base[i]} vs ${shadow[i]} ` +
                  `at ${label}, viewer ${viewer}, trial ${trial}`,
              );
            }
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // The test only has teeth where determinization actually moved something.
    expect(scrambled).toBeGreaterThan(checked / 2);
  });

  it('rotates the viewer to seat offset 0', () => {
    // Seat 0 of the seat block is always the viewer, so the same position read
    // by two different players must put each of their own occupancy, face-up
    // count and expected score in the same place.
    const s = playForward(4242, 5, 60);
    const a = encodeFeatures(s, 0);
    const b = encodeFeatures(s, 3);
    expect(a).not.toEqual(b);
    // Every seat of a five-player table is occupied; the two padding seats are not.
    const seatBase = FEATURE_SIZE - 25 - 10 - 14 - 7 * 16;
    for (const f of [a, b]) {
      for (let offset = 0; offset < 5; offset++) expect(f[seatBase + offset * 16]).toBe(1);
      for (let offset = 5; offset < 7; offset++) expect(f[seatBase + offset * 16]).toBe(0);
    }
  });

  it('fills a supplied buffer identically to allocating one', () => {
    const buffer = new Float32Array(FEATURE_SIZE);
    for (const { s, label } of samplePositions()) {
      for (let viewer = 0; viewer < s.players.length; viewer++) {
        const fresh = encodeFeatures(s, viewer);
        const filled = encodeFeatures(s, viewer, buffer);
        expect(filled, label).toBe(buffer);
        expect(Array.from(filled), label).toEqual(Array.from(fresh));
      }
    }
  });

  it('leaves no residue from a previous call in a reused buffer', () => {
    // The buffer is reused millions of times inside search; a feature written on
    // one call and merely skipped on the next would silently carry over.
    const dirty = new Float32Array(FEATURE_SIZE).fill(0.5);
    const early = playForward(99, 6, 3);
    const late = playForward(99, 6, 400);
    expect(Array.from(encodeFeatures(early, 0, dirty))).toEqual(
      Array.from(encodeFeatures(early, 0)),
    );
    expect(Array.from(encodeFeatures(late, 2, dirty))).toEqual(Array.from(encodeFeatures(late, 2)));
  });

  it('is deterministic', () => {
    const s = playForward(777, 4, 90);
    const first = Array.from(encodeFeatures(s, 1));
    for (let i = 0; i < 5; i++) expect(Array.from(encodeFeatures(s, 1))).toEqual(first);
  });

  it('encodes fast enough for search', () => {
    // The vector feeds a network with a 50us forward-pass budget, so the encoder
    // has to be a rounding error beside it. Reported rather than tightly
    // asserted: the bound here is loose enough not to flake on a busy machine.
    const positions = [
      playForward(11, 6, 30),
      playForward(12, 6, 150),
      playForward(13, 3, 80),
      playForward(14, 7, 200),
    ];
    const buffer = new Float32Array(FEATURE_SIZE);
    for (let i = 0; i < 2000; i++) encodeFeatures(positions[i % 4], i % 3, buffer);

    const iterations = 50000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) encodeFeatures(positions[i % 4], i % 3, buffer);
    const micros = ((performance.now() - start) * 1000) / iterations;
    console.log(`encodeFeatures: ${micros.toFixed(2)}us per call, FEATURE_SIZE=${FEATURE_SIZE}`);
    // A GENEROUS bound, deliberately. Measured 5.96us on an idle machine, but
    // this suite runs while self-play saturates every core, and a tight
    // assertion here fails on machine load rather than on a real regression -
    // it already did once, reporting 21.7us for code that costs 6. What is
    // worth catching in CI is a catastrophic regression, an accidental
    // allocation or an O(n^2), not a busy laptop. Track the real number with
    // `npm run bench`, which reports competing processes alongside it.
    expect(micros).toBeLessThan(250);
  });
});

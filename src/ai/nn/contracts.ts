import type { Action, GameState } from '../../engine/types';

/**
 * Shared contracts for the learned evaluator.
 *
 * This file exists so the pieces of the network work can be built against a
 * fixed interface. Everything here is deliberately small and dependency-free:
 * it imports engine types only, never an implementation.
 */

/** Seats the network is sized for: one human plus MAX_OPPONENTS. */
export const MAX_SEATS = 7;

/**
 * The fixed policy action space, indexed RELATIVE to the player to act.
 *
 *   0      draw center
 *   1      draw pile
 *   2..7   draw from the discard of the seat at offset 1..6 from the mover
 *   8..17  place at spot 0..9
 *   18     discard
 *
 * Offsets rather than absolute seat indices, so a prior learned in one seat
 * transfers to every other seat.
 */
export const POLICY_SIZE = 19;

export const POLICY_DRAW_CENTER = 0;
export const POLICY_DRAW_PILE = 1;
export const POLICY_DRAW_DISCARD_BASE = 2;
export const POLICY_PLACE_BASE = 8;
export const POLICY_DISCARD = 18;

/**
 * Index in the fixed action space for an action taken by `mover` at a table of
 * `numPlayers`. Returns -1 for an action that cannot be represented, which
 * should never happen for a legal action at a supported table size.
 */
export function policyIndex(a: Action, mover: number, numPlayers: number): number {
  if (a.type === 'discard') return POLICY_DISCARD;
  if (a.type === 'place') {
    return a.spot >= 0 && a.spot < 10 ? POLICY_PLACE_BASE + a.spot : -1;
  }
  if (a.source.kind === 'center') return POLICY_DRAW_CENTER;
  if (a.source.kind === 'pile') return POLICY_DRAW_PILE;
  const offset = (a.source.player - mover + numPlayers) % numPlayers;
  if (offset < 1 || offset > 6) return -1;
  return POLICY_DRAW_DISCARD_BASE + (offset - 1);
}

/**
 * One network evaluation of a position.
 *
 * `value` is a REWARD vector in [0, 1], the same quantity `rewardVector`
 * produces and `ismctsSearch` backs up - not a raw score. It is rotated so the
 * player to act is index 0, and padded to MAX_SEATS; entries beyond the real
 * table size are meaningless and must be ignored.
 *
 * `policy` is a distribution over the fixed action space above. It is NOT
 * masked to legal actions: callers mask and renormalise, because legality
 * depends on state the network is not asked to learn.
 */
export interface NetOutput {
  value: Float32Array;
  policy: Float32Array;
}

/**
 * Anything that can score a position for the search.
 *
 * Implementations MUST read only what `viewer` is entitled to see. The binding
 * test is invariance under determinization: for any rng,
 *
 *   evaluate(s, viewer) === evaluate(determinize(s, viewer), viewer)
 *
 * because determinization keeps every visible card and scrambles every hidden
 * one. An implementation that peeks will fail it.
 */
export interface Evaluator {
  readonly name: string;
  evaluate(s: GameState, viewer: number): NetOutput;
}

/** Rotates an absolute seat index into mover-relative space, and back. */
export const toRelativeSeat = (seat: number, mover: number, numPlayers: number): number =>
  (seat - mover + numPlayers) % numPlayers;

export const toAbsoluteSeat = (offset: number, mover: number, numPlayers: number): number =>
  (offset + mover) % numPlayers;

/**
 * One recorded self-play decision.
 *
 * The POSITION is stored rather than its feature vector, so the feature
 * encoding can change without regenerating self-play data. That decoupling is
 * the difference between a one-hour and a twenty-hour iteration, and it is the
 * reason this type holds a `GameState` rather than a `Float32Array`.
 */
export interface TrainingSample {
  /** The position as it stood when the decision was made. */
  position: GameState;
  /** Normalised root visit counts over the fixed action space. */
  policyTarget: Float32Array;
  /**
   * The reward vector the round actually ended on, rotated so the player to
   * act in `position` is index 0. Filled in once the game finishes.
   */
  valueTarget: Float32Array;
}

import type { GameState } from '../../engine/types';
import { POLICY_SIZE, policyIndex, toRelativeSeat, type Evaluator, type NetOutput } from './contracts';
import { FEATURE_SIZE, encodeFeatures } from './features';
import { Net } from './net';
import type { Action } from '../../engine/types';

/**
 * Wraps a trained network as something the search can ask about a position.
 *
 * This is the join between the two halves of the project: `features.ts` turns
 * a position into numbers, `net.ts` turns numbers into a value and a policy,
 * and this turns that pair into the two things ISMCTS actually needs - a
 * reward vector at a leaf, and a prior over the legal moves at a node.
 *
 * The feature buffer is allocated once and refilled, because this runs
 * thousands of times per search and a fresh 343-float array each time would
 * cost more than the arithmetic it feeds.
 */
export interface EvaluatorCalibration {
  /**
   * Multiplies the value head's deviation from `valueCenter`.
   *
   * A trained head regresses toward the mean: generation 0 predicted with a
   * spread of 0.079 where the outcomes it predicts have a spread of 0.174.
   * That is fine for a predictor and quietly bad for a SEARCH, because UCT
   * compares a value difference against a fixed exploration term. Measured at
   * 400 simulations over ten actions that term is 0.116, so it runs at 0.63x
   * the static estimate's value signal - value leads - but 1.47x the raw
   * network's. The search stops being guided and starts wandering, and a
   * better-ordered evaluation loses to a worse one.
   *
   * Scaling restores the balance without touching the ordering the network
   * learned. It is a stretch, not a retraining.
   */
  valueScale?: number;
  /** The point deviations are measured from; the outcome mean by default. */
  valueCenter?: number;
  /**
   * Let the encoder see the face-down cards.
   *
   * Correct, and necessary, for a leaf evaluator inside ISMCTS: the leaf sits
   * in a world the search itself sampled, and evaluating that world is exactly
   * what the rollout being replaced does. See the note on `encodeFeatures`.
   * Never set this for anything reasoning about the real position.
   */
  reveal?: boolean;
}

export function createNetEvaluator(
  net: Net,
  name = 'net',
  calibration: EvaluatorCalibration = {},
): Evaluator {
  if (net.arch.inputSize !== FEATURE_SIZE) {
    throw new Error(
      `evaluator: network expects ${net.arch.inputSize} inputs but the encoder ` +
        `produces ${FEATURE_SIZE}; the weights do not match this build`,
    );
  }
  const buffer = new Float32Array(FEATURE_SIZE);
  const scale = calibration.valueScale ?? 1;
  const center = calibration.valueCenter ?? 0.5;
  const reveal = calibration.reveal ?? false;
  if (scale === 1) {
    return {
      name,
      evaluate(s: GameState, viewer: number): NetOutput {
        encodeFeatures(s, viewer, buffer, reveal);
        // `forward` returns buffers it owns and reuses, so callers must read
        // the result before evaluating anything else. Both callers below do.
        return net.forward(buffer);
      },
    };
  }

  // Calibrated path keeps its own value buffer rather than writing through the
  // network's, which the network reuses and would be surprising to mutate.
  const calibrated: NetOutput = {
    value: new Float32Array(net.arch.valueSize),
    policy: new Float32Array(net.arch.policySize),
  };
  return {
    name,
    evaluate(s: GameState, viewer: number): NetOutput {
      encodeFeatures(s, viewer, buffer, reveal);
      const raw = net.forward(buffer);
      for (let i = 0; i < calibrated.value.length; i++) {
        const stretched = center + (raw.value[i] - center) * scale;
        // Clamped: the reward space is [0,1] and the search assumes it.
        calibrated.value[i] = stretched < 0 ? 0 : stretched > 1 ? 1 : stretched;
      }
      calibrated.policy.set(raw.policy);
      return calibrated;
    },
  };
}

/**
 * The value head as a reward vector in absolute seat order.
 *
 * The network answers rotated to the player to act, which is what lets one
 * network serve every seat; the tree accumulates per absolute seat. This is
 * the only place that rotation is undone.
 *
 * Note the result is already in reward space - the same [0,1] quantity
 * `rewardVector` produces - so unlike a rollout it must NOT be passed through
 * `rewardVector` again.
 */
export function evaluatorReward(
  evaluator: Evaluator,
  s: GameState,
  numPlayers: number,
): number[] {
  const out = evaluator.evaluate(s, s.current);
  const reward = new Array<number>(numPlayers);
  for (let seat = 0; seat < numPlayers; seat++) {
    reward[seat] = out.value[toRelativeSeat(seat, s.current, numPlayers)];
  }
  return reward;
}

/**
 * The policy head as a prior over exactly the actions legal here.
 *
 * Masked and renormalised rather than used raw: the head is trained over a
 * fixed 19-action space and knows nothing about which of those are legal in
 * this position, by design - legality is cheap to compute exactly and would be
 * a waste of network capacity to approximate.
 *
 * Falls back to a uniform prior when the head puts no mass on any legal move.
 * That happens with an untrained network and would otherwise hand the search a
 * vector of zeros, which silently disables prior guidance instead of failing.
 */
export function evaluatorPriors(
  evaluator: Evaluator,
  s: GameState,
  actions: readonly Action[],
  numPlayers: number,
): number[] {
  const out = evaluator.evaluate(s, s.current);
  const priors = new Array<number>(actions.length);
  let sum = 0;
  for (let i = 0; i < actions.length; i++) {
    const index = policyIndex(actions[i], s.current, numPlayers);
    const p = index >= 0 && index < POLICY_SIZE ? out.policy[index] : 0;
    priors[i] = p;
    sum += p;
  }
  if (sum <= 0) return priors.fill(1 / Math.max(1, actions.length));
  for (let i = 0; i < priors.length; i++) priors[i] /= sum;
  return priors;
}

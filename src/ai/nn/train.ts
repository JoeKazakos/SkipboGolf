import { makeRng, type Rng } from '../../engine/rng';
import type { Net, Tensor } from './net';

/**
 * Backpropagation, Adam and minibatching, in plain TypeScript.
 *
 * The whole thing is deterministic from a seed: weight initialisation, batch
 * shuffling and the order gradients are accumulated in are all fixed, so two
 * runs with the same seed and the same data produce bit-identical weights.
 * That is what makes the exact-resume checkpoint test in `checkpoint.test.ts`
 * meaningful rather than approximate.
 */

/** One training example. Features are recomputed upstream; this sees floats. */
export interface TrainSample {
  input: Float32Array;
  /** Reward per seat in [0, 1], rotated so the player to act is index 0. */
  valueTarget: Float32Array;
  /** A distribution over the fixed action space. */
  policyTarget: Float32Array;
  /**
   * Optional 1/0 mask over value outputs. The net is sized for MAX_SEATS but
   * a real table has 2 to 7 players, and the entries past the table size are
   * meaningless - training them against a made-up target would waste capacity
   * and teach the head that padding has structure. Defaults to all ones.
   */
  valueMask?: Float32Array;
}

export type ValueLossKind = 'bce' | 'mse';

export interface TrainConfig {
  learningRate: number;
  beta1: number;
  beta2: number;
  epsilon: number;
  /** L2 coefficient. The penalty is (weightDecay / 2) * sum(w^2), weights only. */
  weightDecay: number;
  /**
   * Relative weight of the two head losses. Left free because the balance
   * between them is a real tuning knob: the policy head has 19 outputs and a
   * cross-entropy that starts near log(19) = 2.94, the value head has 7 and a
   * BCE that starts near 0.69, so equal weights are not equal influence.
   */
  valueLossWeight: number;
  policyLossWeight: number;
  /**
   * Binary cross-entropy by default, not squared error.
   *
   * The value head is a sigmoid and the targets are already in [0, 1], so
   * both are valid. BCE wins on conditioning: its gradient through the
   * sigmoid is exactly (v - t), whereas MSE picks up an extra v(1 - v) factor
   * that vanishes precisely when the net is confidently wrong - the case we
   * most want a large gradient for. BCE with a continuous target in [0, 1] is
   * still a proper scoring rule, minimised at v = t, so nothing is lost by
   * the targets not being 0/1. 'mse' is kept for comparison.
   */
  valueLoss: ValueLossKind;
  batchSize: number;
  /** Seeds the shuffle. Weight init is seeded separately, at Net.create. */
  seed: number;
}

export const DEFAULT_TRAIN_CONFIG: TrainConfig = {
  learningRate: 1e-3,
  beta1: 0.9,
  beta2: 0.999,
  epsilon: 1e-8,
  weightDecay: 1e-4,
  valueLossWeight: 1,
  policyLossWeight: 1,
  valueLoss: 'bce',
  batchSize: 64,
  seed: 1,
};

/** Loss split by term, so a stalled run can be diagnosed without guessing. */
export interface LossBreakdown {
  total: number;
  value: number;
  policy: number;
  l2: number;
  samples: number;
}

const EMPTY_LOSS: LossBreakdown = { total: 0, value: 0, policy: 0, l2: 0, samples: 0 };

/** Guards the logs in BCE and cross-entropy against log(0). */
const LOG_FLOOR = 1e-7;

export class Trainer {
  readonly net: Net;
  readonly config: TrainConfig;
  /** Adam step count. Drives bias correction, so it must survive a resume. */
  step = 0;
  /** Completed epochs. Bookkeeping for the training script, and for resume. */
  epoch = 0;
  readonly rng: Rng;

  /** Gradient, first moment and second moment, mirroring `net.tensors()`. */
  readonly grads: Float32Array[];
  readonly moment1: Float32Array[];
  readonly moment2: Float32Array[];
  private readonly tensors: Tensor[];

  /** Backprop scratch, preallocated for the same reason the forward pass is. */
  private readonly deltas: Float32Array[];
  private readonly dValue: Float32Array;
  private readonly dPolicy: Float32Array;
  private readonly dTrunk: Float32Array;

  constructor(net: Net, config: Partial<TrainConfig> = {}) {
    this.net = net;
    this.config = { ...DEFAULT_TRAIN_CONFIG, ...config };
    this.rng = makeRng(this.config.seed);

    this.tensors = net.tensors();
    this.grads = this.tensors.map((t) => new Float32Array(t.data.length));
    this.moment1 = this.tensors.map((t) => new Float32Array(t.data.length));
    this.moment2 = this.tensors.map((t) => new Float32Array(t.data.length));

    this.deltas = net.hidden.map((l) => new Float32Array(l.outSize));
    this.dValue = new Float32Array(net.arch.valueSize);
    this.dPolicy = new Float32Array(net.arch.policySize);
    this.dTrunk = new Float32Array(net.trunk.length);
  }

  /** Forward only: the loss the current weights achieve on these samples. */
  evaluateLoss(samples: readonly TrainSample[]): LossBreakdown {
    if (samples.length === 0) return { ...EMPTY_LOSS };
    let value = 0;
    let policy = 0;
    for (const s of samples) {
      const out = this.net.forward(s.input);
      value += valueLossOf(out.value, s, this.config.valueLoss);
      policy += policyLossOf(out.policy, s.policyTarget);
    }
    return this.combine(value / samples.length, policy / samples.length, samples.length);
  }

  /**
   * Accumulates the gradient of the batch loss into `grads`, and returns the
   * loss it was taken at.
   *
   * Split out from the optimiser step so the gradient check can look at raw
   * gradients, and so a caller could clip or inspect them.
   */
  accumulateGradients(samples: readonly TrainSample[]): LossBreakdown {
    for (const g of this.grads) g.fill(0);
    if (samples.length === 0) return { ...EMPTY_LOSS };

    const { valueLossWeight, policyLossWeight, valueLoss } = this.config;
    const scale = 1 / samples.length;
    let valueSum = 0;
    let policySum = 0;

    for (const s of samples) {
      const out = this.net.forward(s.input);
      valueSum += valueLossOf(out.value, s, valueLoss);
      policySum += policyLossOf(out.policy, s.policyTarget);

      // dL/d(value logits). With BCE through a sigmoid this is just
      // (v - t); with MSE the sigmoid derivative survives.
      const mask = s.valueMask;
      let active = 0;
      for (let k = 0; k < this.dValue.length; k++) active += mask ? mask[k] : 1;
      const vScale = active > 0 ? valueLossWeight * scale / active : 0;
      for (let k = 0; k < this.dValue.length; k++) {
        const m = mask ? mask[k] : 1;
        const v = out.value[k];
        const diff = v - s.valueTarget[k];
        this.dValue[k] = m * vScale * (valueLoss === 'bce' ? diff : 2 * diff * v * (1 - v));
      }

      // dL/d(policy logits) for softmax + cross-entropy is p * sum(t) - t.
      // The sum(t) factor is 1 for a proper distribution, but visit-count
      // targets have been seen to arrive slightly off, and carrying it makes
      // the gradient correct either way.
      let targetSum = 0;
      for (let k = 0; k < s.policyTarget.length; k++) targetSum += s.policyTarget[k];
      const pScale = policyLossWeight * scale;
      for (let k = 0; k < this.dPolicy.length; k++) {
        this.dPolicy[k] = pScale * (out.policy[k] * targetSum - s.policyTarget[k]);
      }

      this.backward(s.input);
    }

    // L2 is a property of the weights, not of the batch, so it is added once.
    const { weightDecay } = this.config;
    if (weightDecay !== 0) {
      for (let i = 0; i < this.tensors.length; i++) {
        if (!this.tensors[i].isWeight) continue;
        const w = this.tensors[i].data;
        const g = this.grads[i];
        for (let j = 0; j < w.length; j++) g[j] += weightDecay * w[j];
      }
    }

    return this.combine(valueSum * scale, policySum * scale, samples.length);
  }

  /**
   * Pushes one sample's head gradients back through the shared trunk.
   *
   * Both heads read the same trunk activation, so their contributions to the
   * trunk gradient add - that summation is the only place the two-head
   * structure shows up in the backward pass.
   */
  private backward(input: Float32Array): void {
    const net = this.net;
    const trunk = net.trunk;
    const nHidden = net.hidden.length;

    this.dTrunk.fill(0);
    accumulateHead(net.value, this.dValue, trunk, this.gradFor('value'), this.dTrunk);
    accumulateHead(net.policy, this.dPolicy, trunk, this.gradFor('policy'), this.dTrunk);

    // Walk the trunk backwards. ReLU's derivative is readable straight off the
    // stored post-activation: it is 1 exactly where the activation is positive.
    let dOut = this.dTrunk;
    for (let l = nHidden - 1; l >= 0; l--) {
      const a = net.acts[l];
      const d = this.deltas[l];
      // For every layer but the last, `dOut` IS `d` - the previous iteration
      // accumulated straight into it. The masking below is elementwise at the
      // same index, so writing in place is safe, and it saves a buffer.
      for (let j = 0; j < d.length; j++) d[j] = a[j] > 0 ? dOut[j] : 0;

      const layer = net.hidden[l];
      const inputToLayer = l === 0 ? input : net.acts[l - 1];
      const gw = this.grads[l * 2];
      const gb = this.grads[l * 2 + 1];
      for (let j = 0; j < layer.outSize; j++) {
        const dj = d[j];
        if (dj === 0) {
          continue; // ReLU killed this unit; its whole weight row gets zero.
        }
        gb[j] += dj;
        const base = j * layer.inSize;
        for (let i = 0; i < layer.inSize; i++) gw[base + i] += dj * inputToLayer[i];
      }

      if (l > 0) {
        const dPrev = this.deltas[l - 1];
        dPrev.fill(0);
        for (let j = 0; j < layer.outSize; j++) {
          const dj = d[j];
          if (dj === 0) continue;
          const base = j * layer.inSize;
          for (let i = 0; i < layer.inSize; i++) dPrev[i] += dj * layer.w[base + i];
        }
        dOut = dPrev;
      }
    }
  }

  /** Index of a head's weight gradient in the fixed tensor order. */
  private gradFor(head: 'value' | 'policy'): { w: Float32Array; b: Float32Array } {
    const base = this.net.hidden.length * 2 + (head === 'value' ? 0 : 2);
    return { w: this.grads[base], b: this.grads[base + 1] };
  }

  /** One Adam step from whatever is currently in `grads`. */
  applyGradients(): void {
    const { learningRate, beta1, beta2, epsilon } = this.config;
    this.step++;
    // Bias correction. Without it the first steps are tiny, because both
    // moments start at zero; with it Adam takes a full-size step immediately.
    const c1 = 1 - Math.pow(beta1, this.step);
    const c2 = 1 - Math.pow(beta2, this.step);
    for (let i = 0; i < this.tensors.length; i++) {
      const p = this.tensors[i].data;
      const g = this.grads[i];
      const m = this.moment1[i];
      const v = this.moment2[i];
      for (let j = 0; j < p.length; j++) {
        const gj = g[j];
        const mj = beta1 * m[j] + (1 - beta1) * gj;
        const vj = beta2 * v[j] + (1 - beta2) * gj * gj;
        m[j] = mj;
        v[j] = vj;
        p[j] -= (learningRate * (mj / c1)) / (Math.sqrt(vj / c2) + epsilon);
      }
    }
  }

  /** Gradient plus optimiser step for one minibatch. */
  trainBatch(samples: readonly TrainSample[]): LossBreakdown {
    const loss = this.accumulateGradients(samples);
    if (samples.length > 0) this.applyGradients();
    return loss;
  }

  /**
   * One pass over the data in a seeded random order.
   *
   * The shuffle consumes the trainer's own rng, so its state is part of what a
   * checkpoint has to save: resume with a fresh rng and the second epoch would
   * see a different ordering and diverge.
   */
  trainEpoch(samples: readonly TrainSample[]): LossBreakdown {
    const order = this.shuffledIndices(samples.length);
    const size = Math.max(1, this.config.batchSize);
    let value = 0;
    let policy = 0;
    let batches = 0;
    for (let start = 0; start < order.length; start += size) {
      const batch: TrainSample[] = [];
      for (let i = start; i < Math.min(start + size, order.length); i++) {
        batch.push(samples[order[i]]);
      }
      const loss = this.trainBatch(batch);
      value += loss.value;
      policy += loss.policy;
      batches++;
    }
    this.epoch++;
    if (batches === 0) return { ...EMPTY_LOSS };
    return this.combine(value / batches, policy / batches, samples.length);
  }

  /** Fisher-Yates over indices, so the sample array itself is never copied. */
  private shuffledIndices(n: number): Int32Array {
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return order;
  }

  private combine(value: number, policy: number, samples: number): LossBreakdown {
    const l2 = this.l2Penalty();
    return {
      total: this.config.valueLossWeight * value + this.config.policyLossWeight * policy + l2,
      value,
      policy,
      l2,
      samples,
    };
  }

  /** (weightDecay / 2) * sum of squared weights. Biases are excluded. */
  l2Penalty(): number {
    const { weightDecay } = this.config;
    if (weightDecay === 0) return 0;
    let sum = 0;
    for (const t of this.tensors) {
      if (!t.isWeight) continue;
      for (let i = 0; i < t.data.length; i++) sum += t.data[i] * t.data[i];
    }
    return (weightDecay / 2) * sum;
  }
}

/**
 * Head gradient: weight and bias gradients for the head itself, plus the
 * head's contribution to the trunk gradient, added in place.
 */
function accumulateHead(
  layer: { w: Float32Array; inSize: number; outSize: number },
  dOut: Float32Array,
  trunk: Float32Array,
  grad: { w: Float32Array; b: Float32Array },
  dTrunk: Float32Array,
): void {
  for (let j = 0; j < layer.outSize; j++) {
    const dj = dOut[j];
    if (dj === 0) continue;
    grad.b[j] += dj;
    const base = j * layer.inSize;
    for (let i = 0; i < layer.inSize; i++) {
      grad.w[base + i] += dj * trunk[i];
      dTrunk[i] += dj * layer.w[base + i];
    }
  }
}

/** Mean over the ACTIVE seats, so a two-player sample is not diluted by padding. */
function valueLossOf(v: Float32Array, s: TrainSample, kind: ValueLossKind): number {
  const mask = s.valueMask;
  let total = 0;
  let active = 0;
  for (let k = 0; k < v.length; k++) {
    const m = mask ? mask[k] : 1;
    if (m === 0) continue;
    active += m;
    const t = s.valueTarget[k];
    if (kind === 'bce') {
      const p = Math.min(1 - LOG_FLOOR, Math.max(LOG_FLOOR, v[k]));
      total += m * -(t * Math.log(p) + (1 - t) * Math.log(1 - p));
    } else {
      const d = v[k] - t;
      total += m * d * d;
    }
  }
  return active > 0 ? total / active : 0;
}

/** Cross-entropy of the target distribution under the predicted one. */
function policyLossOf(p: Float32Array, target: Float32Array): number {
  let total = 0;
  for (let k = 0; k < p.length; k++) {
    const t = target[k];
    if (t === 0) continue;
    total += -t * Math.log(Math.max(LOG_FLOOR, p[k]));
  }
  return total;
}

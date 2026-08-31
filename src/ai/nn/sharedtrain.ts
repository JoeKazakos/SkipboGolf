import { makeRng, type Rng } from '../../engine/rng';
import { MAX_SEATS } from './contracts';
import { SharedNet, type Tensor } from './sharednet';
import type { TrainConfig, TrainSample, LossBreakdown } from './train';
import { DEFAULT_TRAIN_CONFIG } from './train';

/**
 * Training for the shared per-seat encoder.
 *
 * Nearly all of this is the ordinary backward pass. The one part that is not,
 * and the only part worth reading carefully, is that the seat encoder runs
 * SEVEN times per forward pass with the same weights, so its gradient is the
 * SUM of the seven contributions. Getting that wrong does not crash and does
 * not look wrong; it just learns badly, which is why the gradient check in
 * sharedtrain.test.ts is the gate on this file rather than review.
 */

const EMPTY_LOSS: LossBreakdown = { total: 0, value: 0, policy: 0, l2: 0, samples: 0 };

function valueLossOf(pred: Float32Array, sample: TrainSample, kind: 'bce' | 'mse'): number {
  const mask = sample.valueMask;
  let sum = 0;
  let active = 0;
  for (let k = 0; k < pred.length; k++) {
    const m = mask ? mask[k] : 1;
    if (m === 0) continue;
    active += 1;
    const v = Math.min(1 - 1e-7, Math.max(1e-7, pred[k]));
    const t = sample.valueTarget[k];
    sum += kind === 'bce' ? -(t * Math.log(v) + (1 - t) * Math.log(1 - v)) : (v - t) ** 2;
  }
  return active > 0 ? sum / active : 0;
}

function policyLossOf(pred: Float32Array, target: Float32Array): number {
  let sum = 0;
  for (let k = 0; k < pred.length; k++) {
    if (target[k] > 0) sum += -target[k] * Math.log(Math.max(1e-9, pred[k]));
  }
  return sum;
}

export class SharedTrainer {
  readonly net: SharedNet;
  readonly config: TrainConfig;
  step = 0;
  epoch = 0;
  readonly rng: Rng;

  readonly grads: Float32Array[];
  readonly moment1: Float32Array[];
  readonly moment2: Float32Array[];
  private readonly tensors: Tensor[];

  private readonly dValue: Float32Array;
  private readonly dPolicy: Float32Array;
  private readonly dTrunk: Float32Array;
  private readonly headDeltas: Float32Array[];
  private readonly dHeadInput: Float32Array;
  private readonly seatDeltas: Float32Array[];
  private readonly dSeatIn: Float32Array;

  constructor(net: SharedNet, config: Partial<TrainConfig> = {}) {
    this.net = net;
    this.config = { ...DEFAULT_TRAIN_CONFIG, ...config };
    this.rng = makeRng(this.config.seed);

    this.tensors = net.tensors();
    this.grads = this.tensors.map((t) => new Float32Array(t.data.length));
    this.moment1 = this.tensors.map((t) => new Float32Array(t.data.length));
    this.moment2 = this.tensors.map((t) => new Float32Array(t.data.length));

    this.dValue = new Float32Array(net.arch.valueSize);
    this.dPolicy = new Float32Array(net.arch.policySize);
    this.dTrunk = new Float32Array(net.trunk.length);
    this.headDeltas = net.headLayers.map((l) => new Float32Array(l.outSize));
    this.dHeadInput = new Float32Array(net.currentHeadInput().length);
    this.seatDeltas = net.seatLayers.map((l) => new Float32Array(l.outSize));
    this.dSeatIn = new Float32Array(net.arch.seatInput);
  }

  /** Index of a tensor pair in the fixed order tensors() produces. */
  private seatGrad(i: number): { w: Float32Array; b: Float32Array } {
    return { w: this.grads[i * 2], b: this.grads[i * 2 + 1] };
  }

  private headGrad(i: number): { w: Float32Array; b: Float32Array } {
    const base = this.net.seatLayers.length * 2 + i * 2;
    return { w: this.grads[base], b: this.grads[base + 1] };
  }

  private outGrad(head: 'value' | 'policy'): { w: Float32Array; b: Float32Array } {
    const base =
      (this.net.seatLayers.length + this.net.headLayers.length) * 2 + (head === 'value' ? 0 : 2);
    return { w: this.grads[base], b: this.grads[base + 1] };
  }

  evaluateLoss(samples: readonly TrainSample[]): LossBreakdown {
    if (samples.length === 0) return { ...EMPTY_LOSS };
    let value = 0;
    let policy = 0;
    for (const s of samples) {
      const out = this.net.forward(s.input);
      value += valueLossOf(out.value, s, this.config.valueLoss);
      policy += policyLossOf(out.policy, s.policyTarget);
    }
    const n = samples.length;
    return this.combine(value / n, policy / n, n);
  }

  private combine(value: number, policy: number, samples: number): LossBreakdown {
    let l2 = 0;
    for (let i = 0; i < this.tensors.length; i++) {
      if (!this.tensors[i].isWeight) continue;
      const w = this.tensors[i].data;
      for (let j = 0; j < w.length; j++) l2 += w[j] * w[j];
    }
    l2 = (this.config.weightDecay / 2) * l2;
    return {
      value,
      policy,
      l2,
      samples,
      total: this.config.valueLossWeight * value + this.config.policyLossWeight * policy,
    };
  }

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

      const mask = s.valueMask;
      let active = 0;
      for (let k = 0; k < this.dValue.length; k++) active += mask ? mask[k] : 1;
      const vScale = active > 0 ? (valueLossWeight * scale) / active : 0;
      for (let k = 0; k < this.dValue.length; k++) {
        const m = mask ? mask[k] : 1;
        const v = out.value[k];
        const diff = v - s.valueTarget[k];
        this.dValue[k] = m * vScale * (valueLoss === 'bce' ? diff : 2 * diff * v * (1 - v));
      }

      let targetSum = 0;
      for (let k = 0; k < s.policyTarget.length; k++) targetSum += s.policyTarget[k];
      const pScale = policyLossWeight * scale;
      for (let k = 0; k < this.dPolicy.length; k++) {
        this.dPolicy[k] = pScale * (out.policy[k] * targetSum - s.policyTarget[k]);
      }

      this.backward(s.input);
    }

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

  private backward(input: Float32Array): void {
    const net = this.net;
    const trunk = net.trunk;

    // --- the two output heads, both reading the same trunk ------------------
    this.dTrunk.fill(0);
    this.accumulateHead(net.value, this.dValue, trunk, this.outGrad('value'));
    this.accumulateHead(net.policy, this.dPolicy, trunk, this.outGrad('policy'));

    // --- the head's hidden stack -------------------------------------------
    const headActs = net.headActivations();
    let dOut: Float32Array = this.dTrunk;
    for (let l = net.headLayers.length - 1; l >= 0; l--) {
      const a = headActs[l];
      const d = this.headDeltas[l];
      for (let j = 0; j < d.length; j++) d[j] = a[j] > 0 ? dOut[j] : 0;

      const layer = net.headLayers[l];
      const layerInput = l === 0 ? net.currentHeadInput() : headActs[l - 1];
      const g = this.headGrad(l);
      for (let j = 0; j < layer.outSize; j++) {
        const dj = d[j];
        if (dj === 0) continue;
        g.b[j] += dj;
        const base = j * layer.inSize;
        for (let i = 0; i < layer.inSize; i++) g.w[base + i] += dj * layerInput[i];
      }

      const dPrev = l === 0 ? this.dHeadInput : this.headDeltas[l - 1];
      dPrev.fill(0);
      for (let j = 0; j < layer.outSize; j++) {
        const dj = d[j];
        if (dj === 0) continue;
        const base = j * layer.inSize;
        for (let i = 0; i < layer.inSize; i++) dPrev[i] += dj * layer.w[base + i];
      }
      dOut = dPrev;
    }

    // --- the shared seat encoder, once per seat -----------------------------
    // THE point of this file. Every seat uses the same weights, so each of the
    // seven backward passes ADDS to the same gradient buffers rather than
    // writing them. The gradient of a shared parameter is the sum over its
    // uses; anything else silently trains on one seventh of the signal.
    const { seatInput, seatEmbed } = net.arch;
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      const acts = net.seatActivations(seat);
      const last = net.seatLayers.length - 1;

      // Gradient arriving at this seat's embedding, sliced out of the head's.
      const dEmbed = this.seatDeltas[last];
      for (let j = 0; j < seatEmbed; j++) dEmbed[j] = this.dHeadInput[seat * seatEmbed + j];

      let downstream: Float32Array = dEmbed;
      for (let l = last; l >= 0; l--) {
        const a = acts[l];
        const d = this.seatDeltas[l];
        for (let j = 0; j < d.length; j++) d[j] = a[j] > 0 ? downstream[j] : 0;

        const layer = net.seatLayers[l];
        const layerInput =
          l === 0 ? input.subarray(seat * seatInput, (seat + 1) * seatInput) : acts[l - 1];
        const g = this.seatGrad(l);
        for (let j = 0; j < layer.outSize; j++) {
          const dj = d[j];
          if (dj === 0) continue;
          g.b[j] += dj;
          const base = j * layer.inSize;
          for (let i = 0; i < layer.inSize; i++) g.w[base + i] += dj * layerInput[i];
        }

        if (l > 0) {
          const dPrev = this.seatDeltas[l - 1];
          dPrev.fill(0);
          for (let j = 0; j < layer.outSize; j++) {
            const dj = d[j];
            if (dj === 0) continue;
            const base = j * layer.inSize;
            for (let i = 0; i < layer.inSize; i++) dPrev[i] += dj * layer.w[base + i];
          }
          downstream = dPrev;
        }
      }
    }
    // The input itself has no gradient, so dSeatIn is never needed; it exists
    // only to document that the chain stops here.
    void this.dSeatIn;
  }

  private accumulateHead(
    layer: { inSize: number; outSize: number; w: Float32Array; b: Float32Array },
    dOut: Float32Array,
    trunk: Float32Array,
    grad: { w: Float32Array; b: Float32Array },
  ): void {
    for (let j = 0; j < layer.outSize; j++) {
      const dj = dOut[j];
      if (dj === 0) continue;
      grad.b[j] += dj;
      const base = j * layer.inSize;
      for (let i = 0; i < layer.inSize; i++) {
        grad.w[base + i] += dj * trunk[i];
        this.dTrunk[i] += dj * layer.w[base + i];
      }
    }
  }

  applyGradients(): void {
    const { learningRate, beta1, beta2, epsilon } = this.config;
    this.step += 1;
    const c1 = 1 - Math.pow(beta1, this.step);
    const c2 = 1 - Math.pow(beta2, this.step);
    for (let t = 0; t < this.tensors.length; t++) {
      const data = this.tensors[t].data;
      const g = this.grads[t];
      const m1 = this.moment1[t];
      const m2 = this.moment2[t];
      for (let i = 0; i < data.length; i++) {
        m1[i] = beta1 * m1[i] + (1 - beta1) * g[i];
        m2[i] = beta2 * m2[i] + (1 - beta2) * g[i] * g[i];
        data[i] -= (learningRate * (m1[i] / c1)) / (Math.sqrt(m2[i] / c2) + epsilon);
      }
    }
  }

  trainBatch(samples: readonly TrainSample[]): LossBreakdown {
    const loss = this.accumulateGradients(samples);
    this.applyGradients();
    return loss;
  }

  trainEpoch(samples: readonly TrainSample[]): LossBreakdown {
    const order = samples.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let value = 0;
    let policy = 0;
    let batches = 0;
    for (let at = 0; at < order.length; at += this.config.batchSize) {
      const batch = order.slice(at, at + this.config.batchSize).map((i) => samples[i]);
      const loss = this.trainBatch(batch);
      value += loss.value;
      policy += loss.policy;
      batches += 1;
    }
    this.epoch += 1;
    return batches > 0
      ? this.combine(value / batches, policy / batches, samples.length)
      : { ...EMPTY_LOSS };
  }
}

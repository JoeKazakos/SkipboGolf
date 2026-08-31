import { describe, expect, it } from 'vitest';
import { makeRng } from '../../engine/rng';
import { MAX_SEATS } from './contracts';
import { SharedNet, sharedInputSize, type SharedArch } from './sharednet';
import { SharedTrainer } from './sharedtrain';
import type { TrainConfig, TrainSample } from './train';

/**
 * Gates for the shared per-seat encoder.
 *
 * The gradient check is the reason to believe this file at all. The seat
 * encoder runs seven times per forward pass with one set of weights, so its
 * gradient is the SUM of seven contributions. Getting that wrong - summing over
 * one seat, or averaging instead of summing - does not crash and does not look
 * wrong in any output. It just trains on a fraction of the signal, and the only
 * thing that would ever reveal it is a run that quietly underperforms weeks
 * later. Finite differences catch it immediately.
 */

const SMALL: SharedArch = {
  seatInput: 6,
  seatHidden: [5],
  seatEmbed: 4,
  globalInput: 3,
  headHidden: [7],
  valueSize: 3,
  policySize: 4,
};

function randomSample(rng: { next: () => number }, arch: SharedArch): TrainSample {
  const input = new Float32Array(sharedInputSize(arch));
  for (let i = 0; i < input.length; i++) input[i] = rng.next() * 2 - 1;
  const valueTarget = new Float32Array(arch.valueSize);
  for (let i = 0; i < valueTarget.length; i++) valueTarget[i] = rng.next();
  const policyTarget = new Float32Array(arch.policySize);
  let sum = 0;
  for (let i = 0; i < policyTarget.length; i++) {
    policyTarget[i] = rng.next() + 0.05;
    sum += policyTarget[i];
  }
  for (let i = 0; i < policyTarget.length; i++) policyTarget[i] /= sum;
  return { input, valueTarget, policyTarget };
}

function gradientCheck(config: Partial<TrainConfig>, seed: number) {
  const rng = makeRng(seed);
  const net = SharedNet.create(SMALL, seed);
  const trainer = new SharedTrainer(net, { ...config, weightDecay: 0 });
  const samples = Array.from({ length: 4 }, () => randomSample(rng, SMALL));

  // Which ReLUs are on, across every sample, every seat and the head. A
  // perturbation that flips one lands the finite difference on a corner of a
  // piecewise-linear function, where no correct gradient matches.
  const pattern = (): string => {
    let p = '';
    for (const s of samples) {
      net.forward(s.input);
      for (let seat = 0; seat < MAX_SEATS; seat++) {
        for (const a of net.seatActivations(seat)) {
          for (let i = 0; i < a.length; i++) p += a[i] > 0 ? '1' : '0';
        }
      }
      for (const a of net.headActivations()) {
        for (let i = 0; i < a.length; i++) p += a[i] > 0 ? '1' : '0';
      }
    }
    return p;
  };

  for (const g of trainer.grads) g.fill(0);
  trainer.accumulateGradients(samples);

  const tensors = net.tensors();
  const h = 1e-2;
  let checked = 0;
  let skipped = 0;
  let worst = 0;
  let worstName = '';

  for (let t = 0; t < tensors.length; t++) {
    const data = tensors[t].data;
    for (let i = 0; i < data.length; i++) {
      const original = data[i];
      data[i] = original + h;
      const plus = trainer.evaluateLoss(samples).total;
      const plusPattern = pattern();
      data[i] = original - h;
      const minus = trainer.evaluateLoss(samples).total;
      const minusPattern = pattern();
      data[i] = original;

      if (plusPattern !== minusPattern) {
        skipped++;
        continue;
      }
      const numeric = (plus - minus) / (2 * h);
      const analytic = trainer.grads[t][i];
      const scale = Math.max(1e-3, Math.abs(numeric), Math.abs(analytic));
      const relative = Math.abs(numeric - analytic) / scale;
      if (relative > worst) {
        worst = relative;
        worstName = tensors[t].name;
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(skipped * 3);
  return { checked, skipped, worst, worstName };
}

describe('shared encoder gradients', () => {
  it('match finite differences, including the shared seat weights', () => {
    const { checked, worst, worstName } = gradientCheck({}, 5);
    expect(checked).toBeGreaterThan(50);
    // A wrong shared-weight sum shows up here as a large error confined to the
    // seat tensors, so the failure message names where it went wrong.
    expect(`${worstName}:${worst < 0.005}`).toBe(`${worstName}:true`);
  });

  it('match with only the value head active', () => {
    expect(gradientCheck({ policyLossWeight: 0 }, 9).worst).toBeLessThan(0.005);
  });

  it('match with only the policy head active', () => {
    expect(gradientCheck({ valueLossWeight: 0 }, 13).worst).toBeLessThan(0.005);
  });
});

describe('weight sharing', () => {
  it('applies one encoder to every seat', () => {
    // The same seat block in two different positions must produce the same
    // embedding, which is what "shared" means and what makes the encoder
    // player-count agnostic.
    const net = SharedNet.create(SMALL, 3);
    const rng = makeRng(77);
    const block = Float32Array.from({ length: SMALL.seatInput }, () => rng.next() * 2 - 1);

    const a = new Float32Array(sharedInputSize(SMALL));
    a.set(block, 0);
    net.forward(a);
    const embedSeat0 = Float32Array.from(net.seatActivations(0)[net.seatLayers.length - 1]);

    const b = new Float32Array(sharedInputSize(SMALL));
    b.set(block, 3 * SMALL.seatInput);
    net.forward(b);
    const embedSeat3 = Float32Array.from(net.seatActivations(3)[net.seatLayers.length - 1]);

    expect([...embedSeat3]).toEqual([...embedSeat0]);
  });

  it('counts the seat encoder once, not seven times', () => {
    const net = SharedNet.create(SMALL, 1);
    const names = net.tensors().map((t) => t.name);
    expect(names.filter((n) => n.startsWith('seat')).length).toBe(SMALL.seatHidden.length * 2 + 2);
  });
});

describe('shared encoder training', () => {
  it('learns a function of its own shape', () => {
    const teacher = SharedNet.create(SMALL, 99);
    const rng = makeRng(4);
    const samples: TrainSample[] = [];
    for (let i = 0; i < 300; i++) {
      const input = new Float32Array(sharedInputSize(SMALL));
      for (let k = 0; k < input.length; k++) input[k] = rng.next() * 2 - 1;
      const out = teacher.forwardCopy(input);
      samples.push({ input, valueTarget: out.value, policyTarget: out.policy });
    }
    // The teacher sits on the entropy floor, because the targets are its own
    // outputs, so the excess over that floor is the only part that can fall.
    const floor = new SharedTrainer(teacher).evaluateLoss(samples).total;

    const student = SharedNet.create(SMALL, 1);
    const trainer = new SharedTrainer(student, { learningRate: 0.02, batchSize: 32, seed: 5 });
    const before = trainer.evaluateLoss(samples).total;
    for (let e = 0; e < 250; e++) trainer.trainEpoch(samples);
    const after = trainer.evaluateLoss(samples).total;

    expect(Number.isFinite(after)).toBe(true);
    expect(after - floor).toBeLessThan((before - floor) * 0.5);
  });
});

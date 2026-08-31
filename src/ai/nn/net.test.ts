import { describe, expect, it } from 'vitest';
import { makeRng } from '../../engine/rng';
import { Net, type NetArch } from './net';
import { Trainer, type TrainConfig, type TrainSample } from './train';
import { encodeCheckpoint, decodeCheckpoint, restoreTrainer, assertArchMatches } from './checkpoint';
import { flattenParameters } from './serialize';

/**
 * Gates for the learned evaluator's network.
 *
 * These were specified before the network was written and are the reason to
 * believe it works. The gradient check in particular: a subtly wrong backprop
 * does not crash, it quietly fails to learn, and it would surface days later
 * as "training mysteriously plateaus" after a long self-play run had already
 * been spent feeding it.
 */

const SMALL: NetArch = { inputSize: 6, hidden: [7, 5], valueSize: 3, policySize: 4 };

function randomSample(rng: { next: () => number }, arch: NetArch): TrainSample {
  const input = new Float32Array(arch.inputSize);
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

/**
 * Analytic gradients against central finite differences.
 *
 * Two things this has to get right, both of which it got wrong first time.
 *
 * Weight decay is switched off: accumulateGradients folds the L2 term into the
 * gradient but evaluateLoss reports only the data loss, so leaving decay on
 * would compare two different functions and fail for the wrong reason.
 *
 * And coordinates whose perturbation flips a ReLU are SKIPPED. A central
 * difference across a kink measures the chord over a corner of a piecewise
 * linear function, which no correct gradient equals; it is an artifact of the
 * probe, not a defect in the code. Ignoring this reported a worst relative
 * error of 0.44 for a backprop that is accurate to 0.0005 everywhere the
 * function is actually differentiable. The activation pattern is captured
 * either side of the step and the coordinate is dropped when it changes.
 */
function gradientCheck(config: Partial<TrainConfig>, seed: number) {
  const rng = makeRng(seed);
  const net = Net.create(SMALL, seed);
  const trainer = new Trainer(net, { ...config, weightDecay: 0 });
  const samples = Array.from({ length: 5 }, () => randomSample(rng, SMALL));

  // Which ReLUs are on, across every sample and layer. Two evaluations that
  // share this string lie on the same linear piece.
  const pattern = (): string => {
    let p = '';
    for (const s of samples) {
      net.forward(s.input);
      for (const a of net.acts) for (let i = 0; i < a.length; i++) p += a[i] > 0 ? '1' : '0';
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
      if (relative > worst) worst = relative;
      checked++;
    }
  }
  // Guard against the skip rule hollowing the test out: if nearly everything
  // were skipped, a passing result would mean nothing.
  expect(checked).toBeGreaterThan(skipped * 4);
  return { checked, skipped, worst };
}

describe('network gradients', () => {
  it('match finite differences for both heads together', () => {
    const { checked, worst } = gradientCheck({}, 7);
    expect(checked).toBeGreaterThan(20);
    // Tight, because on the smooth pieces this really is exact to five digits.
    // The remaining slack is Float32Array storage against a 1e-2 step.
    expect(worst).toBeLessThan(0.005);
  });

  it('match finite differences for the value head alone', () => {
    expect(gradientCheck({ policyLossWeight: 0 }, 11).worst).toBeLessThan(0.005);
  });

  it('match finite differences for the policy head alone', () => {
    expect(gradientCheck({ valueLossWeight: 0 }, 13).worst).toBeLessThan(0.005);
  });

  it('match finite differences under squared-error value loss', () => {
    expect(gradientCheck({ valueLoss: 'mse' }, 17).worst).toBeLessThan(0.005);
  });
});

describe('training', () => {
  it('learns a function a small net can represent', () => {
    // Targets generated BY a network of the same shape, so a solution provably
    // exists and a failure indicts the optimiser rather than the capacity.
    const teacher = Net.create(SMALL, 99);
    const rng = makeRng(4);
    const samples: TrainSample[] = [];
    for (let i = 0; i < 400; i++) {
      const input = new Float32Array(SMALL.inputSize);
      for (let k = 0; k < input.length; k++) input[k] = rng.next() * 2 - 1;
      const out = teacher.forwardCopy(input);
      samples.push({ input, valueTarget: out.value, policyTarget: out.policy });
    }

    // The loss cannot go to zero, and measuring against zero is why this test
    // first failed on a network that was learning fine. Cross-entropy against
    // a soft target bottoms out at the target's own entropy, and the teacher
    // sits exactly on that floor because the targets ARE its outputs. So the
    // quantity that can actually be driven down is the EXCESS over the floor.
    const floor = new Trainer(teacher).evaluateLoss(samples).total;

    const student = Net.create(SMALL, 1);
    const trainer = new Trainer(student, { learningRate: 0.02, batchSize: 32, seed: 5 });
    const before = trainer.evaluateLoss(samples).total;
    for (let e = 0; e < 300; e++) trainer.trainEpoch(samples);
    const after = trainer.evaluateLoss(samples).total;

    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeGreaterThanOrEqual(floor - 1e-6);
    expect(after - floor).toBeLessThan((before - floor) * 0.25);
  });

  it('produces finite outputs on extreme inputs', () => {
    const net = Net.create(SMALL, 3);
    const input = new Float32Array(SMALL.inputSize).fill(1e6);
    const out = net.forwardCopy(input);
    for (const v of out.value) expect(Number.isFinite(v)).toBe(true);
    let sum = 0;
    for (const p of out.policy) {
      expect(Number.isFinite(p)).toBe(true);
      sum += p;
    }
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe('checkpoints', () => {
  const makeSamples = (n: number) => {
    const rng = makeRng(21);
    return Array.from({ length: n }, () => randomSample(rng, SMALL));
  };

  it('resume produces bit-identical weights to an uninterrupted run', () => {
    const samples = makeSamples(120);

    const straight = new Trainer(Net.create(SMALL, 2), { seed: 8, batchSize: 16 });
    for (let e = 0; e < 12; e++) straight.trainEpoch(samples);

    const interrupted = new Trainer(Net.create(SMALL, 2), { seed: 8, batchSize: 16 });
    for (let e = 0; e < 5; e++) interrupted.trainEpoch(samples);
    const resumed = restoreTrainer(decodeCheckpoint(encodeCheckpoint(interrupted, 'mid-run')));
    for (let e = 0; e < 7; e++) resumed.trainEpoch(samples);

    // Bit-identical, not approximately equal. Adam moments, the step count and
    // the shuffle RNG all have to survive for this to hold, which is exactly
    // what makes a long training run safe to stop and continue.
    const a = flattenParameters(straight.net);
    const b = flattenParameters(resumed.net);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
    expect(resumed.step).toBe(straight.step);
    expect(resumed.epoch).toBe(straight.epoch);
  });

  it('round-trips Adam moments and the step count', () => {
    const samples = makeSamples(64);
    const trainer = new Trainer(Net.create(SMALL, 6), { seed: 3 });
    for (let e = 0; e < 4; e++) trainer.trainEpoch(samples);
    const restored = restoreTrainer(decodeCheckpoint(encodeCheckpoint(trainer)));
    expect(restored.step).toBe(trainer.step);
    for (let t = 0; t < trainer.moment1.length; t++) {
      for (let i = 0; i < trainer.moment1[t].length; i++) {
        expect(restored.moment1[t][i]).toBe(trainer.moment1[t][i]);
        expect(restored.moment2[t][i]).toBe(trainer.moment2[t][i]);
      }
    }
  });

  it('rejects a truncated checkpoint rather than loading part of one', () => {
    const bytes = encodeCheckpoint(new Trainer(Net.create(SMALL, 4)));
    expect(() => decodeCheckpoint(bytes.slice(0, 8))).toThrow();
    expect(() => decodeCheckpoint(bytes.slice(0, bytes.length - 16))).toThrow();
  });

  it('rejects a file that is not a checkpoint', () => {
    const junk = new Uint8Array(512);
    junk.fill(0x41);
    expect(() => decodeCheckpoint(junk)).toThrow();
  });

  it('refuses a checkpoint whose architecture is not the one being trained', () => {
    const decoded = decodeCheckpoint(encodeCheckpoint(new Trainer(Net.create(SMALL, 4))));
    expect(() => assertArchMatches(decoded, { ...SMALL, hidden: [9, 9] })).toThrow();
    expect(() => assertArchMatches(decoded, SMALL)).not.toThrow();
  });
});

import { makeRng, type Rng } from '../../engine/rng';
import { MAX_SEATS, POLICY_SIZE, type NetOutput } from './contracts';
import { GLOBAL_INPUT, SEAT_INPUT } from './seatfeatures';

/**
 * A network with a SHARED per-seat encoder.
 *
 * One sub-network reads a single seat's block of features and emits a small
 * embedding. It is applied to every seat in turn, with the same weights, and
 * the embeddings are concatenated with the table-level features to feed a head
 * network that produces the value and policy.
 *
 * Two properties follow, and they are the reason for the design.
 *
 * The sub-network is player-count agnostic: it only ever sees one seat, so
 * everything it learns about reading a play area applies at every table size.
 * The head is where count-specific strategy lives - how fast a round wraps up
 * with seven players against two, how much the race matters - and it gets the
 * table size explicitly.
 *
 * And the sub-network sees SEVEN grids per position rather than one, so the
 * part of the job that transfers everywhere gets about seven times the training
 * signal per game. The previous flat encoder gave the viewer's grid 140 raw
 * features and each opponent 16 hand-picked summaries, which meant it could
 * only ever learn to read its own play area, and saw opponents through
 * statistics somebody had already chosen.
 */

export interface SharedArch {
  seatInput: number;
  /** Hidden widths inside the per-seat encoder. */
  seatHidden: readonly number[];
  /** Width of each seat's embedding. */
  seatEmbed: number;
  globalInput: number;
  /** Hidden widths in the head. */
  headHidden: readonly number[];
  valueSize: number;
  policySize: number;
}

export const DEFAULT_SHARED_ARCH: SharedArch = {
  seatInput: SEAT_INPUT,
  seatHidden: [32],
  seatEmbed: 20,
  globalInput: GLOBAL_INPUT,
  headHidden: [96, 96],
  valueSize: MAX_SEATS,
  policySize: POLICY_SIZE,
};

export const sharedInputSize = (arch: SharedArch): number =>
  MAX_SEATS * arch.seatInput + arch.globalInput;

const headInputSize = (arch: SharedArch): number =>
  MAX_SEATS * arch.seatEmbed + arch.globalInput;

interface Layer {
  inSize: number;
  outSize: number;
  w: Float32Array;
  b: Float32Array;
}

export interface Tensor {
  name: string;
  data: Float32Array;
  isWeight: boolean;
}

function makeLayer(inSize: number, outSize: number): Layer {
  return { inSize, outSize, w: new Float32Array(inSize * outSize), b: new Float32Array(outSize) };
}

/** He initialisation for ReLU layers, Xavier-ish for the linear outputs. */
function initLayer(layer: Layer, rng: Rng, gain: number): void {
  const scale = Math.sqrt(gain / layer.inSize);
  for (let i = 0; i < layer.w.length; i++) {
    // Box-Muller from the project rng, so a seed reproduces a network exactly.
    const u = Math.max(1e-9, rng.next());
    const v = rng.next();
    layer.w[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * scale;
  }
  layer.b.fill(0);
}

function forwardLayer(layer: Layer, input: Float32Array, out: Float32Array, relu: boolean): void {
  for (let j = 0; j < layer.outSize; j++) {
    let sum = layer.b[j];
    const base = j * layer.inSize;
    for (let i = 0; i < layer.inSize; i++) sum += layer.w[base + i] * input[i];
    out[j] = relu && sum < 0 ? 0 : sum;
  }
}

export class SharedNet {
  readonly arch: SharedArch;
  /** The per-seat encoder: shared weights, applied MAX_SEATS times. */
  readonly seatLayers: Layer[];
  readonly headLayers: Layer[];
  readonly value: Layer;
  readonly policy: Layer;

  /** Per-seat activations, kept for backprop; one row per seat per layer. */
  private readonly seatActs: Float32Array[][];
  private readonly headActs: Float32Array[];
  private readonly headInput: Float32Array;
  private readonly policyLogits: Float32Array;
  private readonly out: NetOutput;
  lastInput: Float32Array | null = null;

  constructor(arch: SharedArch = DEFAULT_SHARED_ARCH) {
    this.arch = { ...arch, seatHidden: [...arch.seatHidden], headHidden: [...arch.headHidden] };

    this.seatLayers = [];
    let prev = arch.seatInput;
    for (const width of arch.seatHidden) {
      this.seatLayers.push(makeLayer(prev, width));
      prev = width;
    }
    // The embedding layer is the last of the seat encoder and is also ReLU'd,
    // so an embedding is a non-negative feature vector rather than a signed one.
    this.seatLayers.push(makeLayer(prev, arch.seatEmbed));

    this.headLayers = [];
    prev = headInputSize(arch);
    for (const width of arch.headHidden) {
      this.headLayers.push(makeLayer(prev, width));
      prev = width;
    }
    this.value = makeLayer(prev, arch.valueSize);
    this.policy = makeLayer(prev, arch.policySize);

    this.seatActs = [];
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      this.seatActs.push(this.seatLayers.map((l) => new Float32Array(l.outSize)));
    }
    this.headActs = this.headLayers.map((l) => new Float32Array(l.outSize));
    this.headInput = new Float32Array(headInputSize(arch));
    this.policyLogits = new Float32Array(arch.policySize);
    this.out = {
      value: new Float32Array(arch.valueSize),
      policy: new Float32Array(arch.policySize),
    };
  }

  static create(arch: SharedArch = DEFAULT_SHARED_ARCH, seed = 1): SharedNet {
    const net = new SharedNet(arch);
    net.randomize(seed);
    return net;
  }

  randomize(seed: number): void {
    const rng = makeRng(seed);
    for (const layer of this.seatLayers) initLayer(layer, rng, 2);
    for (const layer of this.headLayers) initLayer(layer, rng, 2);
    initLayer(this.value, rng, 1);
    initLayer(this.policy, rng, 1);
  }

  /**
   * Parameter tensors in a fixed order.
   *
   * The seat encoder appears ONCE even though it runs seven times: they are the
   * same weights, and that sharing is the point.
   */
  tensors(): Tensor[] {
    const out: Tensor[] = [];
    this.seatLayers.forEach((l, i) => {
      out.push({ name: `seat${i}.w`, data: l.w, isWeight: true });
      out.push({ name: `seat${i}.b`, data: l.b, isWeight: false });
    });
    this.headLayers.forEach((l, i) => {
      out.push({ name: `head${i}.w`, data: l.w, isWeight: true });
      out.push({ name: `head${i}.b`, data: l.b, isWeight: false });
    });
    out.push({ name: 'value.w', data: this.value.w, isWeight: true });
    out.push({ name: 'value.b', data: this.value.b, isWeight: false });
    out.push({ name: 'policy.w', data: this.policy.w, isWeight: true });
    out.push({ name: 'policy.b', data: this.policy.b, isWeight: false });
    return out;
  }

  parameterCount(): number {
    return this.tensors().reduce((n, t) => n + t.data.length, 0);
  }

  /** The head's input vector, exposed for backprop. */
  get trunk(): Float32Array {
    return this.headActs[this.headActs.length - 1];
  }

  forward(input: Float32Array): NetOutput {
    this.lastInput = input;
    const { seatInput, seatEmbed } = this.arch;

    // 1. The shared encoder, once per seat.
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      const block = input.subarray(seat * seatInput, (seat + 1) * seatInput);
      let signal: Float32Array = block as Float32Array;
      for (let l = 0; l < this.seatLayers.length; l++) {
        forwardLayer(this.seatLayers[l], signal, this.seatActs[seat][l], true);
        signal = this.seatActs[seat][l];
      }
      this.headInput.set(signal, seat * seatEmbed);
    }

    // 2. The table-level features, appended after the seat embeddings.
    const globals = input.subarray(MAX_SEATS * seatInput);
    this.headInput.set(globals, MAX_SEATS * seatEmbed);

    // 3. The head.
    let signal = this.headInput;
    for (let l = 0; l < this.headLayers.length; l++) {
      forwardLayer(this.headLayers[l], signal, this.headActs[l], true);
      signal = this.headActs[l];
    }

    for (let k = 0; k < this.value.outSize; k++) {
      let sum = this.value.b[k];
      const base = k * this.value.inSize;
      for (let i = 0; i < this.value.inSize; i++) sum += this.value.w[base + i] * signal[i];
      this.out.value[k] = 1 / (1 + Math.exp(-sum));
    }

    forwardLayer(this.policy, signal, this.policyLogits, false);
    let max = -Infinity;
    for (const v of this.policyLogits) if (v > max) max = v;
    let total = 0;
    for (let k = 0; k < this.policyLogits.length; k++) {
      const e = Math.exp(this.policyLogits[k] - max);
      this.out.policy[k] = e;
      total += e;
    }
    for (let k = 0; k < this.out.policy.length; k++) this.out.policy[k] /= total;

    return this.out;
  }

  forwardCopy(input: Float32Array): NetOutput {
    const o = this.forward(input);
    return { value: Float32Array.from(o.value), policy: Float32Array.from(o.policy) };
  }

  /** Activations of one seat's encoder, for the trainer's backward pass. */
  seatActivations(seat: number): Float32Array[] {
    return this.seatActs[seat];
  }

  headActivations(): Float32Array[] {
    return this.headActs;
  }

  currentHeadInput(): Float32Array {
    return this.headInput;
  }
}

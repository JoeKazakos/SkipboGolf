import { makeRng, type Rng } from '../../engine/rng';
import { FEATURE_SIZE } from './features';
import { MAX_SEATS, POLICY_SIZE, type NetOutput } from './contracts';

/**
 * A small multilayer perceptron, hand-rolled on Float32Arrays.
 *
 * No dependency, deliberately. This has to ship inside the existing search
 * Web Worker, and TensorFlow.js would add megabytes to the bundle to run a
 * network whose whole forward pass is about seventy thousand multiply-adds.
 * At that size the framework costs more than the model.
 *
 * Two design points drive everything below.
 *
 * 1. WEIGHTS ARE ROW-MAJOR BY OUTPUT UNIT: w[j * inSize + i] is the weight
 *    from input i to output j. So computing one output unit walks a
 *    contiguous run of the weight array against the whole input vector, which
 *    is the layout the cache wants. Column-major would stride.
 *
 * 2. THE FORWARD PASS ALLOCATES NOTHING. Every intermediate lives in a
 *    preallocated scratch buffer owned by the net, and `forward` returns a
 *    reused NetOutput. This runs millions of times inside a tree search; at
 *    that rate per-call allocation, not arithmetic, becomes the bill. The
 *    price is that the returned arrays are only valid until the next
 *    `forward`, which callers must respect (`forwardCopy` is there for when
 *    they cannot).
 */

/** The shape of a network. Everything needed to rebuild it, and nothing else. */
export interface NetArch {
  /** Length of the feature vector the encoder produces. */
  inputSize: number;
  /** Hidden layer widths, in order. */
  hidden: readonly number[];
  /** Value head outputs: one reward per seat, padded to MAX_SEATS. */
  valueSize: number;
  /** Policy head outputs: the fixed action space. */
  policySize: number;
}

/**
 * The architecture we ship, chosen from the benchmark in `bench.ts`.
 *
 * Measured on this machine (Node 22, warm), 400-float input, mean over 200k
 * forward passes:
 *
 *   hidden [64]        ~11 us
 *   hidden [96]        ~16 us
 *   hidden [128]       ~21 us
 *   hidden [128, 128]  ~26 us
 *
 * The budget is 50 us, because that replaces a 300-500 us heuristic rollout.
 * [128, 128] sits comfortably inside it with room for the feature encoder,
 * and the second hidden layer is worth far more to a policy head than the
 * extra width would be. Re-run `npm run bench:nn` after any kernel change.
 */
export const DEFAULT_ARCH: NetArch = {
  // Tied to the encoder rather than guessed. This read 400 while the two were
  // built in parallel, which would have thrown on the first real forward pass.
  inputSize: FEATURE_SIZE,
  hidden: [128, 128],
  valueSize: MAX_SEATS,
  policySize: POLICY_SIZE,
};

/** One fully connected layer. `w` is row-major by output unit; see above. */
export interface Layer {
  inSize: number;
  outSize: number;
  w: Float32Array;
  b: Float32Array;
}

/**
 * A named parameter tensor. The ORDER of `tensors()` is the serialisation
 * order and the Adam moment order, so it must stay stable across a save and
 * load; `serialize.ts` and `checkpoint.ts` both rely on it.
 */
export interface Tensor {
  name: string;
  data: Float32Array;
  /** Weights get L2 decay; biases do not. Decaying biases only shifts the
   * function without buying any regularisation worth having. */
  isWeight: boolean;
}

function makeLayer(inSize: number, outSize: number): Layer {
  return {
    inSize,
    outSize,
    w: new Float32Array(inSize * outSize),
    b: new Float32Array(outSize),
  };
}

/**
 * Standard normal by Box-Muller, drawn from the engine's seeded PRNG.
 *
 * Everything in this project is reproducible from a seed, initial weights
 * included, so this goes through `makeRng` rather than `Math.random`.
 */
function gaussian(rng: Rng): number {
  // u must be strictly positive or the log blows up; mulberry32 can return 0.
  let u = rng.next();
  while (u <= 0) u = rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * He initialisation for the ReLU trunk, Xavier for the heads.
 *
 * ReLU zeroes half its inputs, so the variance-preserving scale is 2/fanIn;
 * the heads are sigmoid and softmax, which are linear near zero, so they want
 * the symmetric 1/fanIn. Getting this wrong is not fatal but it does cost the
 * first few hundred training steps.
 */
function initLayer(layer: Layer, rng: Rng, gainOverFanIn: number): void {
  const sd = Math.sqrt(gainOverFanIn / layer.inSize);
  for (let i = 0; i < layer.w.length; i++) layer.w[i] = gaussian(rng) * sd;
  layer.b.fill(0);
}

/** out = w * x + b, for a whole layer. The inner loop is the hot one. */
function dense(layer: Layer, x: Float32Array, out: Float32Array): void {
  const { w, b, inSize, outSize } = layer;
  for (let j = 0; j < outSize; j++) {
    const base = j * inSize;
    // Four-way unrolled: measured about 20% faster than the naive loop on
    // this machine, because it hides the load latency of the weight stream.
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let i = 0;
    const limit = inSize - 3;
    for (; i < limit; i += 4) {
      s0 += w[base + i] * x[i];
      s1 += w[base + i + 1] * x[i + 1];
      s2 += w[base + i + 2] * x[i + 2];
      s3 += w[base + i + 3] * x[i + 3];
    }
    let s = s0 + s1 + s2 + s3;
    for (; i < inSize; i++) s += w[base + i] * x[i];
    out[j] = s + b[j];
  }
}

export class Net {
  readonly arch: NetArch;
  readonly hidden: Layer[];
  readonly value: Layer;
  readonly policy: Layer;

  /** Post-ReLU activation of each hidden layer. Reused every forward pass. */
  readonly acts: Float32Array[];
  /** Pre-softmax policy logits, kept separate so backprop can read the probs. */
  private readonly policyLogits: Float32Array;
  private readonly out: NetOutput;
  /** The input of the most recent forward pass, for backprop. Not copied. */
  lastInput: Float32Array | null = null;

  constructor(arch: NetArch) {
    if (arch.inputSize <= 0) throw new Error('net: inputSize must be positive');
    if (arch.hidden.length === 0) throw new Error('net: needs at least one hidden layer');
    this.arch = { ...arch, hidden: [...arch.hidden] };

    this.hidden = [];
    let prev = arch.inputSize;
    for (const width of arch.hidden) {
      if (width <= 0) throw new Error('net: hidden widths must be positive');
      this.hidden.push(makeLayer(prev, width));
      prev = width;
    }
    this.value = makeLayer(prev, arch.valueSize);
    this.policy = makeLayer(prev, arch.policySize);

    this.acts = this.hidden.map((l) => new Float32Array(l.outSize));
    this.policyLogits = new Float32Array(arch.policySize);
    this.out = {
      value: new Float32Array(arch.valueSize),
      policy: new Float32Array(arch.policySize),
    };
  }

  /** Fresh weights from a seed. Same seed, same net, on any machine. */
  static create(arch: NetArch = DEFAULT_ARCH, seed = 1): Net {
    const net = new Net(arch);
    net.randomize(seed);
    return net;
  }

  randomize(seed: number): void {
    const rng = makeRng(seed);
    for (const layer of this.hidden) initLayer(layer, rng, 2);
    initLayer(this.value, rng, 1);
    initLayer(this.policy, rng, 1);
  }

  /** The trunk output the two heads share: the last hidden activation. */
  get trunk(): Float32Array {
    return this.acts[this.acts.length - 1];
  }

  /**
   * Every parameter tensor in a fixed, stable order.
   *
   * Called on the serialisation and checkpoint paths, not in the hot loop, so
   * building the array each time is fine.
   */
  tensors(): Tensor[] {
    const out: Tensor[] = [];
    this.hidden.forEach((l, i) => {
      out.push({ name: `hidden${i}.w`, data: l.w, isWeight: true });
      out.push({ name: `hidden${i}.b`, data: l.b, isWeight: false });
    });
    out.push({ name: 'value.w', data: this.value.w, isWeight: true });
    out.push({ name: 'value.b', data: this.value.b, isWeight: false });
    out.push({ name: 'policy.w', data: this.policy.w, isWeight: true });
    out.push({ name: 'policy.b', data: this.policy.b, isWeight: false });
    return out;
  }

  /** Total scalar parameters. Serialised payloads are checked against this. */
  parameterCount(): number {
    let n = 0;
    for (const t of this.tensors()) n += t.data.length;
    return n;
  }

  /**
   * One evaluation.
   *
   * The returned arrays are the net's own scratch buffers and are overwritten
   * by the next call. Copy them if you need to keep them - or use
   * `forwardCopy`, which does it for you.
   */
  forward(input: Float32Array): NetOutput {
    if (input.length !== this.arch.inputSize) {
      throw new Error(
        `net: expected an input of ${this.arch.inputSize} floats, got ${input.length}`,
      );
    }
    this.lastInput = input;

    let x = input;
    for (let l = 0; l < this.hidden.length; l++) {
      const a = this.acts[l];
      dense(this.hidden[l], x, a);
      // ReLU. Chosen over tanh or GELU because it is a single compare with no
      // transcendental: measured at hidden [128, 128] a tanh trunk costs about
      // 4 us more per forward pass, 20% of the whole budget, and buys nothing
      // this problem needs. It also cannot saturate, so a deep-ish trunk keeps
      // training without any warm-up trickery.
      for (let j = 0; j < a.length; j++) if (a[j] < 0) a[j] = 0;
      x = a;
    }

    // Value head: sigmoid, because the target is a reward vector already
    // bounded to [0, 1]. A linear head would have to learn the bound.
    const v = this.out.value;
    dense(this.value, x, v);
    for (let k = 0; k < v.length; k++) v[k] = 1 / (1 + Math.exp(-v[k]));

    // Policy head: softmax over the fixed action space, max-subtracted so a
    // large logit cannot overflow to Infinity and poison the whole vector.
    const logits = this.policyLogits;
    dense(this.policy, x, logits);
    const p = this.out.policy;
    let max = -Infinity;
    for (let k = 0; k < logits.length; k++) if (logits[k] > max) max = logits[k];
    let sum = 0;
    for (let k = 0; k < logits.length; k++) {
      const e = Math.exp(logits[k] - max);
      p[k] = e;
      sum += e;
    }
    const inv = 1 / sum;
    for (let k = 0; k < p.length; k++) p[k] *= inv;

    return this.out;
  }

  /** Like `forward`, but the result is yours to keep. */
  forwardCopy(input: Float32Array): NetOutput {
    const o = this.forward(input);
    return { value: new Float32Array(o.value), policy: new Float32Array(o.policy) };
  }

  /** A deep copy, weights included. Used to compare training runs. */
  clone(): Net {
    const copy = new Net(this.arch);
    const from = this.tensors();
    const to = copy.tensors();
    for (let i = 0; i < from.length; i++) to[i].data.set(from[i].data);
    return copy;
  }
}

/** True when two architectures would produce identical parameter layouts. */
export function sameArch(a: NetArch, b: NetArch): boolean {
  return (
    a.inputSize === b.inputSize &&
    a.valueSize === b.valueSize &&
    a.policySize === b.policySize &&
    a.hidden.length === b.hidden.length &&
    a.hidden.every((h, i) => h === b.hidden[i])
  );
}

export function describeArch(a: NetArch): string {
  return `${a.inputSize}-[${a.hidden.join(',')}]-(${a.valueSize}v,${a.policySize}p)`;
}

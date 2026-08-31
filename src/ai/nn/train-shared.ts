/**
 * Trains the SHARED per-seat network on a self-play generation.
 *
 * A deliberate near-copy of train-run.ts rather than a branch inside it. The
 * two architectures are being compared head to head on identical data, and a
 * shared training path invites exactly the kind of change that improves one and
 * silently alters the other. They are meant to meet only in the arena.
 *
 * Usage:
 *   TS_GENERATION=0 TS_EPOCHS=40 TS_REVEAL=1 npm run train:shared
 */
import { checkpointFs, writeFileAtomic } from './checkpoint';
import { encodeShared, SHARED_INPUT } from './seatfeatures';
import { DEFAULT_SELFPLAY, positionOf, readGeneration, type RawSample, type SelfPlayConfig } from './selfplay';
import { DEFAULT_SHARED_ARCH, SharedNet } from './sharednet';
import { serializeShared, sharedMetaFor } from './sharedserialize';
import { SharedTrainer } from './sharedtrain';
import type { TrainSample } from './train';

declare const process:
  | { env?: Record<string, string | undefined>; exit?: (code: number) => void }
  | undefined;

const join = (...parts: string[]): string => parts.join('/');

let REVEAL = false;

function batchOf(raw: readonly RawSample[], indices: readonly number[]): TrainSample[] {
  const batch: TrainSample[] = [];
  for (const i of indices) {
    const sample = raw[i];
    const state = positionOf(sample);
    const input = new Float32Array(SHARED_INPUT);
    encodeShared(state, state.current, input, REVEAL);
    batch.push({
      input,
      valueTarget: sample.valueTarget,
      policyTarget: sample.policyTarget,
      valueMask: sample.valueMask,
    });
  }
  return batch;
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const generation = Number(env.TS_GENERATION ?? 0);
  const epochs = Number(env.TS_EPOCHS ?? 30);
  const learningRate = Number(env.TS_LR ?? 1e-3);
  const batchSize = Number(env.TS_BATCH ?? 256);
  const shards = Number(env.TS_SHARDS ?? 240);
  const root = env.TS_ROOT ?? 'training';
  REVEAL = env.TS_REVEAL === '1';
  const suffix = REVEAL ? '-shared-reveal' : '-shared';

  const config: SelfPlayConfig = { ...DEFAULT_SELFPLAY, generation };
  const dir = join(root, `gen${String(generation).padStart(3, '0')}`);

  console.log(`training the shared network on generation ${generation}, reveal=${REVEAL}`);
  const all = await readGeneration(config, shards, root);
  if (all.length === 0) {
    console.error(`no samples in ${dir}/shards - run npm run selfplay first`);
    if (typeof process !== 'undefined' && process?.exit) process.exit(1);
    return;
  }

  // The same fixed split rule as the flat trainer, so the two runs are held out
  // on exactly the same positions and their numbers are comparable.
  const holdout: RawSample[] = [];
  const train: RawSample[] = [];
  for (let i = 0; i < all.length; i++) (i % 10 === 0 ? holdout : train).push(all[i]);

  const net = SharedNet.create(DEFAULT_SHARED_ARCH, 20260830);
  const trainer = new SharedTrainer(net, { learningRate, batchSize, seed: 7 });
  console.log(`  ${train.length} training samples, ${holdout.length} held out`);
  console.log(`  ${net.parameterCount()} parameters, input ${SHARED_INPUT}`);

  const holdoutBatch = batchOf(holdout, holdout.map((_, i) => i).slice(0, 4096));

  // Held-out loss per table size: the shared encoder is meant to transfer
  // across counts, and the aggregate cannot show whether a rare size lags.
  const bySize = new Map<number, TrainSample[]>();
  for (let i = 0; i < holdout.length && i < 20000; i++) {
    const n = positionOf(holdout[i]).players.length;
    const bucket = bySize.get(n) ?? [];
    if (bucket.length < 1024) {
      bucket.push(...batchOf(holdout, [i]));
      bySize.set(n, bucket);
    }
  }
  const sizes = [...bySize.keys()].sort((a, b) => a - b);

  for (let e = 0; e < epochs; e++) {
    const order = train.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(trainer.rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let lossSum = 0;
    let batches = 0;
    for (let at = 0; at < order.length; at += batchSize) {
      lossSum += trainer.trainBatch(batchOf(train, order.slice(at, at + batchSize))).total;
      batches += 1;
    }
    trainer.epoch = e + 1;

    const heldOut = trainer.evaluateLoss(holdoutBatch);
    console.log(
      `  epoch ${String(e + 1).padStart(3)}  train ${(lossSum / Math.max(1, batches)).toFixed(4)}` +
        `  holdout ${heldOut.total.toFixed(4)}` +
        `  (value ${heldOut.value.toFixed(4)}, policy ${heldOut.policy.toFixed(4)})`,
    );
    if ((e + 1) % 5 === 0 || e + 1 === epochs) {
      const parts = sizes.map((n) => {
        const l = trainer.evaluateLoss(bySize.get(n) as TrainSample[]);
        return `${n}p ${l.total.toFixed(3)}`;
      });
      console.log(`         by size: ${parts.join('  ')}`);
    }
  }

  await writeFileAtomic(join(dir, `weights${suffix}.bin`), serializeShared(net));
  await writeFileAtomic(
    join(dir, `weights${suffix}.meta.json`),
    new TextEncoder().encode(
      JSON.stringify(sharedMetaFor(net, `generation ${generation}, shared${REVEAL ? ', reveal' : ''}`), null, 2),
    ),
  );
  console.log(`  wrote ${dir}/weights${suffix}.bin`);
  void checkpointFs;
}

void main();

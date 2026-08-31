/**
 * Trains a network on a self-play generation, resumably.
 *
 * Run it, stop it, run it again: it picks up from the newest checkpoint in the
 * generation's directory and carries on. That was an explicit requirement, and
 * it is also just necessary - a generation is hours of training on top of
 * hours of self-play, and a run that must not be interrupted is a run that has
 * to be right first time.
 *
 * Usage (env vars, following the project's arena conventions):
 *   TR_GENERATION=0 TR_EPOCHS=40 npm run train
 */
import { checkpointFs, checkpointName, decodeCheckpoint, encodeCheckpoint, restoreTrainer, writeFileAtomic } from './checkpoint';
import { FEATURE_SIZE, encodeFeatures } from './features';
import { DEFAULT_ARCH, Net } from './net';
import { serializeWeights, metaFor } from './serialize';
import { DEFAULT_SELFPLAY, positionOf, readGeneration, type RawSample, type SelfPlayConfig } from './selfplay';
import { Trainer, type TrainSample } from './train';

declare const process:
  | { argv?: string[]; env?: Record<string, string | undefined>; exit?: (code: number) => void }
  | undefined;

const join = (...parts: string[]): string => parts.join('/');

/**
 * Turns stored samples into training samples, one batch at a time.
 *
 * Features are recomputed here rather than stored, which is the decision that
 * lets the encoding change without regenerating self-play. Doing it per batch
 * rather than up front matters at scale: a million samples held as feature
 * vectors is 1.4GB, while the positions they come from are 400MB, and the
 * encoding costs about 6us each - six seconds an epoch, against a heap that
 * would not fit.
 */
let REVEAL = false;

function batchOf(raw: readonly RawSample[], indices: readonly number[]): TrainSample[] {
  const batch: TrainSample[] = [];
  for (const i of indices) {
    const sample = raw[i];
    const state = positionOf(sample);
    const input = new Float32Array(FEATURE_SIZE);
    encodeFeatures(state, state.current, input, REVEAL);
    batch.push({
      input,
      valueTarget: sample.valueTarget,
      policyTarget: sample.policyTarget,
      valueMask: sample.valueMask,
    });
  }
  return batch;
}

/** Newest checkpoint in a directory, or null if there is none to resume from. */
async function latestCheckpoint(dir: string): Promise<string | null> {
  const fs = await checkpointFs();
  if (!fs.existsSync(dir)) return null;
  // checkpointName zero-pads, so a plain sort is a chronological sort.
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ckpt')).sort();
  return files.length > 0 ? join(dir, files[files.length - 1]) : null;
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const generation = Number(env.TR_GENERATION ?? 0);
  const epochs = Number(env.TR_EPOCHS ?? 30);
  const learningRate = Number(env.TR_LR ?? 1e-3);
  const batchSize = Number(env.TR_BATCH ?? 256);
  const shards = Number(env.TR_SHARDS ?? 18);
  const holdoutFraction = Number(env.TR_HOLDOUT ?? 0.1);
  const root = env.TR_ROOT ?? 'training';
  // Train the encoder to SEE the face-down cards. Correct for a leaf evaluator
  // inside a determinized search, where the hidden cards are a sample the
  // search drew - and the stored positions carry the real ones, so no new
  // self-play is needed to train it. See the note on encodeFeatures.
  REVEAL = env.TR_REVEAL === '1';
  const suffix = REVEAL ? '-reveal' : '';

  const config: SelfPlayConfig = { ...DEFAULT_SELFPLAY, generation };
  const dir = join(root, `gen${String(generation).padStart(3, '0')}`);
  const ckptDir = join(dir, `checkpoints${suffix}`);

  console.log(`training on generation ${generation}`);
  const all = await readGeneration(config, shards, root);
  if (all.length === 0) {
    console.error(`no samples found in ${dir}/shards - run npm run selfplay first`);
    if (typeof process !== 'undefined' && process?.exit) process.exit(1);
    return;
  }

  // A held-out slice, split by a fixed rule rather than at random, so the same
  // data always splits the same way and two runs are comparable. Held-out loss
  // is the honest signal: training loss falling while it rises is overfitting,
  // and with correlated samples from the same games that is a real risk.
  const holdout: RawSample[] = [];
  const train: RawSample[] = [];
  const every = Math.max(2, Math.round(1 / Math.max(0.01, holdoutFraction)));
  for (let i = 0; i < all.length; i++) (i % every === 0 ? holdout : train).push(all[i]);
  console.log(`  ${train.length} training samples, ${holdout.length} held out`);

  let trainer: Trainer;
  const resumeFrom = await latestCheckpoint(ckptDir);
  if (resumeFrom) {
    const fs = await checkpointFs();
    trainer = restoreTrainer(decodeCheckpoint(fs.readFileSync(resumeFrom)), {
      learningRate,
      batchSize,
    });
    console.log(`  resuming from ${resumeFrom} at epoch ${trainer.epoch}, step ${trainer.step}`);
  } else {
    trainer = new Trainer(Net.create(DEFAULT_ARCH, 20260830), { learningRate, batchSize, seed: 7 });
    console.log(`  fresh network: ${trainer.net.parameterCount()} parameters`);
  }

  const holdoutBatch = batchOf(holdout, holdout.map((_, i) => i).slice(0, 4096));

  /**
   * Held-out loss split by table size.
   *
   * One network serves tables of two through seven, conditioned on the table
   * size it is given as a feature. Whether that TRANSFERS or merely interferes
   * is an empirical question, and it is not one the aggregate loss can answer:
   * a two-player table contributes about 34 samples per game against a
   * seven-player table's 88, so the rare sizes are a small enough slice of the
   * data to be quietly bad while the average looks fine.
   *
   * If a size lags badly here, the fix is to reweight the self-play mix, not
   * to split the network - most of the skill (column cancellation, squares,
   * which card to place where) is identical at every table size, so a size
   * trained alone would see far less of the structure it shares.
   */
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
  console.log(
    `  holdout by table size: ${sizes.map((n) => `${n}p=${bySize.get(n)?.length}`).join(' ')}`,
  );

  const startEpoch = trainer.epoch;

  for (let e = startEpoch; e < epochs; e++) {
    // Shuffle through the trainer's own rng so a resumed run draws the same
    // batches an uninterrupted one would have.
    const order = train.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(trainer.rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    let seen = 0;
    let lossSum = 0;
    let batches = 0;
    for (let at = 0; at < order.length; at += batchSize) {
      const slice = order.slice(at, at + batchSize);
      const loss = trainer.trainBatch(batchOf(train, slice));
      lossSum += loss.total;
      batches += 1;
      seen += slice.length;
    }
    trainer.epoch = e + 1;

    const heldOut = trainer.evaluateLoss(holdoutBatch);
    console.log(
      `  epoch ${String(e + 1).padStart(3)}  train ${(lossSum / Math.max(1, batches)).toFixed(4)}` +
        `  holdout ${heldOut.total.toFixed(4)}` +
        `  (value ${heldOut.value.toFixed(4)}, policy ${heldOut.policy.toFixed(4)})` +
        `  ${seen} samples`,
    );

    // Per-size breakdown occasionally: it is the only signal that says whether
    // one network really serves every table size or just the common one.
    if ((e + 1) % 5 === 0 || e + 1 === epochs) {
      const parts = sizes.map((n) => {
        const l = trainer.evaluateLoss(bySize.get(n) as TrainSample[]);
        return `${n}p ${l.total.toFixed(3)}`;
      });
      console.log(`         by size: ${parts.join('  ')}`);
    }

    await writeFileAtomic(join(ckptDir, checkpointName(trainer.epoch)), encodeCheckpoint(trainer, `gen${generation}`));
  }

  // The shippable artefact: weights alone, without optimiser state.
  await writeFileAtomic(join(dir, `weights${suffix}.bin`), serializeWeights(trainer.net));
  await writeFileAtomic(
    join(dir, `weights${suffix}.meta.json`),
    new TextEncoder().encode(
      JSON.stringify(
        metaFor(trainer.net, `generation ${generation}${REVEAL ? ', reveal encoder' : ''}`),
        null,
        2,
      ),
    ),
  );
  console.log(`  wrote ${dir}/weights${suffix}.bin`);
}

void main();

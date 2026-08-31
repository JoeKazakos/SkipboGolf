/**
 * Is a player's hidden hand predictable from what they have shown?
 *
 * The perfect-information probe says 310 Elo sits in hidden-information
 * handling, and `determinize` currently deals the unseen cards UNIFORMLY -
 * which is the correct prior given no information, and there is information.
 *
 * Before building any of that, this asks the cheap question: does a model
 * predict a seat's face-down ranks better than the uniform-over-unseen baseline
 * the search uses today? If it cannot, the whole idea is dead for the price of
 * one script rather than another multi-hour build. Four confident mechanisms
 * have already been refuted in this milestone; this one gets tested first.
 *
 * Input is the MASKED encoding - what an observer can actually see. Target is
 * the true multiset of that seat's face-down ranks, which the stored positions
 * carry. Baseline is the normalised unseen-rank census, exactly what a uniform
 * deal assumes.
 *
 * Usage: IP_SAMPLES=60000 npm run infer:probe
 */
import { knownCards } from '../../engine/state';
import { checkpointFs } from './checkpoint';
import { MAX_SEATS } from './contracts';
import { decodeShard, positionOf } from './selfplay';
import { encodeShared, GLOBAL_INPUT, SEAT_INPUT, seatOrder, SHARED_INPUT } from './seatfeatures';
import { Net } from './net';
import { Trainer, type TrainSample } from './train';
import { metaFor, serializeWeights } from './serialize';
import { writeFileAtomic } from './checkpoint';

declare const process: { env?: Record<string, string | undefined> } | undefined;

const RANKS = 13;
/** One seat's block plus the table block: what an observer knows about a seat. */
const INPUT = SEAT_INPUT + GLOBAL_INPUT;

interface Row {
  input: Float32Array;
  /** Normalised counts of this seat's face-down ranks. */
  target: Float32Array;
  /** Normalised unseen-rank census: what a uniform deal assumes. */
  baseline: Float32Array;
}

function crossEntropy(pred: Float32Array, target: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < RANKS; i++) {
    if (target[i] > 0) sum += -target[i] * Math.log(Math.max(1e-9, pred[i]));
  }
  return sum;
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const wanted = Number(env.IP_SAMPLES ?? 60000);
  const epochs = Number(env.IP_EPOCHS ?? 12);
  const dir = env.IP_DIR ?? 'training/gen100/shards';

  const fs = await checkpointFs();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'));

  const rows: Row[] = [];
  const shared = new Float32Array(SHARED_INPUT);

  outer: for (const file of files) {
    for (const sample of decodeShard(fs.readFileSync(`${dir}/${file}`))) {
      const s = positionOf(sample);
      const viewer = s.current;
      encodeShared(s, viewer, shared, false);

      // What nobody has seen, by rank. This is the uniform deal's prior.
      const unseen = new Array<number>(14).fill(0);
      for (let r = 1; r <= 12; r++) unseen[r] = 12;
      unseen[13] = 18;
      for (const card of knownCards(s, viewer)) unseen[card.rank] -= 1;
      let unseenTotal = 0;
      for (let r = 1; r <= 13; r++) unseenTotal += Math.max(0, unseen[r]);
      if (unseenTotal <= 0) continue;

      const order = seatOrder(viewer, s.players.length);
      for (let offset = 0; offset < MAX_SEATS; offset++) {
        const seat = order[offset];
        // The viewer's own face-down cards are unknown to them too, but an
        // opponent's are the ones the search must guess about, so skip self.
        if (seat < 0 || seat === viewer) continue;

        const counts = new Float32Array(RANKS);
        let hidden = 0;
        for (const slot of s.players[seat].grid) {
          if (!slot.faceUp) {
            counts[slot.card.rank - 1] += 1;
            hidden += 1;
          }
        }
        if (hidden === 0) continue;
        for (let i = 0; i < RANKS; i++) counts[i] /= hidden;

        const baseline = new Float32Array(RANKS);
        for (let r = 1; r <= 13; r++) baseline[r - 1] = Math.max(0, unseen[r]) / unseenTotal;

        const input = new Float32Array(INPUT);
        input.set(shared.subarray(offset * SEAT_INPUT, (offset + 1) * SEAT_INPUT), 0);
        input.set(shared.subarray(MAX_SEATS * SEAT_INPUT), SEAT_INPUT);

        rows.push({ input, target: counts, baseline });
        if (rows.length >= wanted) break outer;
      }
    }
  }

  // Fixed split, so two runs are comparable.
  const train: Row[] = [];
  const test: Row[] = [];
  rows.forEach((r, i) => (i % 10 === 0 ? test : train).push(r));
  console.log(`hidden-hand probe: ${train.length} training rows, ${test.length} held out\n`);

  const toSample = (r: Row): TrainSample => ({
    input: r.input,
    valueTarget: new Float32Array(1),
    policyTarget: r.target,
    valueMask: new Float32Array(1),
  });

  const net = Net.create(
    { inputSize: INPUT, hidden: [96, 96], valueSize: 1, policySize: RANKS },
    4242,
  );
  const trainer = new Trainer(net, {
    learningRate: 1e-3,
    batchSize: 256,
    valueLossWeight: 0,
    policyLossWeight: 1,
    seed: 5,
  });

  const testSamples = test.map(toSample);
  const uniform = test.reduce((a, r) => a + crossEntropy(r.baseline, r.target), 0) / test.length;

  for (let e = 0; e < epochs; e++) {
    trainer.trainEpoch(train.map(toSample));
    const model = trainer.evaluateLoss(testSamples).policy;
    console.log(
      `  epoch ${String(e + 1).padStart(2)}  model ${model.toFixed(4)}   uniform baseline ${uniform.toFixed(4)}` +
        `   ${model < uniform ? `BETTER by ${(uniform - model).toFixed(4)}` : 'worse'}`,
    );
  }

  const final = trainer.evaluateLoss(testSamples).policy;
  console.log(
    `\ncross-entropy over the ranks of an opponent's face-down cards:\n` +
      `  uniform over unseen (what determinize does today): ${uniform.toFixed(4)}\n` +
      `  learned from the visible position:                 ${final.toFixed(4)}\n` +
      `  improvement: ${(100 * (uniform - final) / uniform).toFixed(1)}%`,
  );
  const savePath = env.IP_SAVE;
  if (savePath) {
    await writeFileAtomic(savePath, serializeWeights(net));
    await writeFileAtomic(
      savePath.replace(/\.bin$/, '.meta.json'),
      new TextEncoder().encode(
        JSON.stringify(metaFor(net, 'hidden-hand inference, per-seat rank propensity'), null, 2),
      ),
    );
    console.log(`  saved ${savePath}`);
  }

  console.log(
    final < uniform
      ? '\nThere is signal. Weighting the deal by this is worth building.'
      : '\nNo signal. The uniform prior is already right, and the 310 Elo is not\nreachable this way - which is worth knowing for the price of one script.',
  );
}

void main();

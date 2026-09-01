/**
 * Which architecture can actually learn this game?
 *
 * Every architectural choice so far was judged by an arena run costing hours,
 * so exactly two architectures were ever tried. That is not a search, and the
 * conclusions drawn from it were stated with more confidence than two points
 * deserve.
 *
 * This is the fast loop: train several architectures on the SAME positions with
 * the same held-out split, and score them on how well they reproduce the
 * search's own move distribution. Minutes rather than hours, so a dozen
 * architectures cost less than one arena.
 *
 * Two things it reports that a loss curve does not:
 *
 * TOP-1 AGREEMENT with the teacher's best move, which is what a prior is
 * actually for - the search wants the right move ranked first far more than it
 * wants a calibrated tail.
 *
 * The ENDGAME slice, positions where the mover has three or fewer cards left to
 * turn. There the outcome is nearly determined, so the learnable signal is at
 * its highest. An architecture that cannot fit those has no chance on the rest,
 * which makes this the floor test rather than a detail.
 *
 * Usage: AB_SAMPLES=120000 AB_EPOCHS=12 npm run arch:bench
 */
import { checkpointFs } from './checkpoint';
import { POLICY_SIZE } from './contracts';
import { encodeFeatures, FEATURE_SIZE } from './features';
import { Net } from './net';
import { encodeShared, SHARED_INPUT } from './seatfeatures';
import { DEFAULT_SHARED_ARCH, SharedNet } from './sharednet';
import { SharedTrainer } from './sharedtrain';
import { decodeShard, positionOf } from './selfplay';
import { Trainer, type TrainSample } from './train';

declare const process: { env?: Record<string, string | undefined> } | undefined;

interface Row {
  flat: Float32Array;
  shared: Float32Array;
  target: Float32Array;
  /** Mover has three or fewer face-down cards: the endgame slice. */
  endgame: boolean;
}

const argmax = (a: Float32Array): number => {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
};

function crossEntropy(pred: Float32Array, target: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < POLICY_SIZE; i++) {
    if (target[i] > 0) sum += -target[i] * Math.log(Math.max(1e-9, pred[i]));
  }
  return sum;
}

interface Score {
  ce: number;
  top1: number;
  endgameCe: number;
  endgameTop1: number;
}

function score(predict: (r: Row) => Float32Array, rows: readonly Row[]): Score {
  let ce = 0;
  let hits = 0;
  let endCe = 0;
  let endHits = 0;
  let endN = 0;
  for (const r of rows) {
    const p = predict(r);
    const c = crossEntropy(p, r.target);
    const hit = argmax(p) === argmax(r.target) ? 1 : 0;
    ce += c;
    hits += hit;
    if (r.endgame) {
      endCe += c;
      endHits += hit;
      endN += 1;
    }
  }
  return {
    ce: ce / rows.length,
    top1: hits / rows.length,
    endgameCe: endN > 0 ? endCe / endN : 0,
    endgameTop1: endN > 0 ? endHits / endN : 0,
  };
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const wanted = Number(env.AB_SAMPLES ?? 120000);
  const epochs = Number(env.AB_EPOCHS ?? 12);
  const dirs = (env.AB_DIRS ?? 'training/gen100/shards,training/gen101/shards').split(',');

  const fs = await checkpointFs();
  const rows: Row[] = [];
  const flatBuf = new Float32Array(FEATURE_SIZE);
  const sharedBuf = new Float32Array(SHARED_INPUT);

  outer: for (const dir of dirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.bin'))) {
      for (const sample of decodeShard(fs.readFileSync(`${dir}/${file}`))) {
        const s = positionOf(sample);
        let faceDown = 0;
        for (const slot of s.players[s.current].grid) if (!slot.faceUp) faceDown += 1;

        encodeFeatures(s, s.current, flatBuf, false);
        encodeShared(s, s.current, sharedBuf, false);
        rows.push({
          flat: Float32Array.from(flatBuf),
          shared: Float32Array.from(sharedBuf),
          target: sample.policyTarget,
          endgame: faceDown <= 3,
        });
        if (rows.length >= wanted) break outer;
      }
    }
  }

  const train: Row[] = [];
  const test: Row[] = [];
  rows.forEach((r, i) => (i % 10 === 0 ? test : train).push(r));
  const endgameShare = test.filter((r) => r.endgame).length / test.length;
  console.log(
    `architecture bench: ${train.length} training rows, ${test.length} held out, ` +
      `${(100 * endgameShare).toFixed(0)}% of them endgame\n`,
  );

  // The floor every architecture must beat: a uniform prior over the action
  // space. Anything at or near this has learned nothing worth having.
  const uniform = new Float32Array(POLICY_SIZE).fill(1 / POLICY_SIZE);
  const base = score(() => uniform, test);
  const results: { name: string; params: number; s: Score }[] = [
    { name: 'uniform (floor)', params: 0, s: base },
  ];

  const flatSamples = (rs: readonly Row[]): TrainSample[] =>
    rs.map((r) => ({
      input: r.flat,
      valueTarget: new Float32Array(1),
      policyTarget: r.target,
      valueMask: new Float32Array(1),
    }));
  const sharedSamples = (rs: readonly Row[]): TrainSample[] =>
    rs.map((r) => ({
      input: r.shared,
      valueTarget: new Float32Array(1),
      policyTarget: r.target,
      valueMask: new Float32Array(1),
    }));

  const trainFlat = flatSamples(train);
  const trainShared = sharedSamples(train);

  // Policy only: the value head has been flat at 0.638 through every
  // configuration tried, and this is a search for POLICY capacity.
  const cfg = { learningRate: 1.2e-3, batchSize: 512, valueLossWeight: 0, policyLossWeight: 1, seed: 5 };

  // Sizes come from AB_ARCHS when given, e.g. "320x160,512x256", so the search
  // can be pushed outward without editing the file. The first pass found the
  // curve still climbing at 164k parameters, which is the reason to look
  // further rather than settle on the best of an arbitrary list.
  const flatArchs = env.AB_ARCHS
    ? env.AB_ARCHS.split(',').map((a) => a.split('x').map(Number))
    : [[64], [128, 128], [192, 192], [256, 256], [128, 128, 128], [320, 160]];
  for (const hidden of flatArchs) {
    const net = Net.create(
      { inputSize: FEATURE_SIZE, hidden, valueSize: 1, policySize: POLICY_SIZE },
      4242,
    );
    const trainer = new Trainer(net, cfg);
    for (let e = 0; e < epochs; e++) trainer.trainEpoch(trainFlat);
    results.push({
      name: `flat [${hidden.join(', ')}]`,
      params: net.parameterCount(),
      s: score((r) => net.forward(r.flat).policy, test),
    });
    console.log(`  done: flat [${hidden.join(', ')}]`);
  }

  // The shared encoder lost decisively on the first pass - its best
  // configuration at 120k parameters trailed the SMALLEST flat net at 23k, on
  // the head that actually learns. Kept as one control rather than three.
  const sharedArchs = env.AB_SKIP_SHARED
    ? []
    : ([[[96, 48], 32, [192, 192]]] as const);
  for (const [seatHidden, seatEmbed, headHidden] of sharedArchs) {
    const arch = {
      ...DEFAULT_SHARED_ARCH,
      seatHidden: [...seatHidden],
      seatEmbed,
      headHidden: [...headHidden],
      valueSize: 1,
      policySize: POLICY_SIZE,
    };
    const net = SharedNet.create(arch, 4242);
    const trainer = new SharedTrainer(net, cfg);
    for (let e = 0; e < epochs; e++) trainer.trainEpoch(trainShared);
    results.push({
      name: `shared seat[${seatHidden.join(',')}]->${seatEmbed} head[${headHidden.join(',')}]`,
      params: net.parameterCount(),
      s: score((r) => net.forward(r.shared).policy, test),
    });
    console.log(`  done: shared seat[${seatHidden.join(',')}] embed ${seatEmbed}`);
  }

  results.sort((a, b) => a.s.ce - b.s.ce);
  console.log('\narchitecture                                params      ce   top-1    endgame ce   endgame top-1');
  for (const r of results) {
    console.log(
      r.name.padEnd(42) +
        String(r.params).padStart(7) +
        r.s.ce.toFixed(3).padStart(8) +
        (100 * r.s.top1).toFixed(1).padStart(7) +
        '%' +
        r.s.endgameCe.toFixed(3).padStart(13) +
        (100 * r.s.endgameTop1).toFixed(1).padStart(15) +
        '%',
    );
  }
  console.log(
    '\nTop-1 is what a prior is for: the search wants the right move ranked first.\n' +
      'The endgame columns are the floor test - there the position is nearly\n' +
      'determined, so an architecture that cannot fit those cannot fit anything.',
  );
}

void main();

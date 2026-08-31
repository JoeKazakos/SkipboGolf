/**
 * Is the trained value head better than the static estimate it replaces?
 *
 * The raw training loss cannot answer this. The value target is a reward in
 * [0,1] and the loss is a cross-entropy, so most of what it reports is the
 * target's own entropy - an irreducible floor of about 0.58 out of 0.64. A
 * head that learns a great deal moves that number by a hundredth, which reads
 * as "flat" and invites the wrong conclusion.
 *
 * What matters is the comparison against `expectedScore`, the static snapshot
 * a truncated rollout falls back on, since that is precisely what the network
 * displaces at a leaf. Correlation and RMSE against the outcome the round
 * actually reached answer it directly.
 *
 * This is a DIAGNOSTIC, not a gate. Being a better predictor is necessary but
 * not sufficient: this project has twice watched a better predictor play
 * worse, so `npm run net:arena` still decides.
 *
 * Usage:
 *   VD_WEIGHTS=training/gen000/weights.bin npm run net:diag
 */
import { DEFAULT_EVAL_PARAMS, expectedScore, gridView } from '../heuristic';
import { rewardVector } from '../ismcts';
import { checkpointFs } from './checkpoint';
import { FEATURE_SIZE, encodeFeatures } from './features';
import { decodeShard, positionOf } from './selfplay';
import { deserializeWeights, type WeightsMeta } from './serialize';

declare const process: { env?: Record<string, string | undefined> } | undefined;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]): number => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

function correlation(a: readonly number[], b: readonly number[]): number {
  const am = mean(a);
  const bm = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - am) * (b[i] - bm);
    da += (a[i] - am) ** 2;
    db += (b[i] - bm) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function rmse(pred: readonly number[], target: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < target.length; i++) s += (pred[i] - target[i]) ** 2;
  return Math.sqrt(s / target.length);
}

async function main(): Promise<void> {
  const env = (typeof process !== 'undefined' && process?.env) || {};
  const weightsPath = env.VD_WEIGHTS ?? 'training/gen000/weights.bin';
  const generation = env.VD_GENERATION ?? '000';
  const limit = Number(env.VD_SAMPLES ?? 12000);

  const fs = await checkpointFs();
  const meta = JSON.parse(
    new TextDecoder().decode(fs.readFileSync(weightsPath.replace(/\.bin$/, '.meta.json'))),
  ) as WeightsMeta;
  const net = deserializeWeights(fs.readFileSync(weightsPath), meta);

  const dir = `training/gen${generation}/shards`;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'));

  const target: number[] = [];
  const fromNet: number[] = [];
  const fromStatic: number[] = [];
  const buffer = new Float32Array(FEATURE_SIZE);
  let seen = 0;

  outer: for (const file of files) {
    for (const sample of decodeShard(fs.readFileSync(`${dir}/${file}`))) {
      // Every tenth, matching the trainer's holdout rule.
      if (seen++ % 10 !== 0) continue;
      const state = positionOf(sample);
      encodeFeatures(state, state.current, buffer);
      fromNet.push(net.forward(buffer).value[0]);

      const scores = state.players.map((p) =>
        expectedScore(gridView(p.grid), DEFAULT_EVAL_PARAMS.hiddenEv, DEFAULT_EVAL_PARAMS.pMatch),
      );
      fromStatic.push(rewardVector(scores)[state.current]);
      target.push(sample.valueTarget[0]);
      if (target.length >= limit) break outer;
    }
  }

  console.log(`value head diagnostic: ${target.length} held-out positions\n`);
  console.log('estimator                correlation     rmse       spread');
  console.log(
    `trained value head          ${correlation(fromNet, target).toFixed(3)}       ` +
      `${rmse(fromNet, target).toFixed(4)}     ${sd(fromNet).toFixed(4)}`,
  );
  console.log(
    `static estimateScores       ${correlation(fromStatic, target).toFixed(3)}       ` +
      `${rmse(fromStatic, target).toFixed(4)}     ${sd(fromStatic).toFixed(4)}`,
  );
  console.log(`outcome (what both predict)   -            -        ${sd(target).toFixed(4)}\n`);

  const spreadRatio = sd(fromNet) / sd(target);
  if (spreadRatio < 0.7) {
    console.log(
      `NOTE: the head's spread is ${(spreadRatio * 100).toFixed(0)}% of the outcome's.\n` +
        'An underconfident value compresses the gap between good and bad leaves,\n' +
        'while the UCT exploration term keeps its full size - so the search leans\n' +
        'more explorative than its tuning intends. If the arena disappoints while\n' +
        'correlation is good, suspect this before suspecting the network.',
    );
  }
}

void main();

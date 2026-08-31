import { applyAction, createInitialState, isTerminal, legalActions, returns } from '../../engine/state';
import type { Action, GameState } from '../../engine/types';
import { actionKey, ismctsSearch, rewardVector } from '../ismcts';
import { checkpointFs } from './checkpoint';
import { MAX_SEATS, POLICY_SIZE, policyIndex, toRelativeSeat, type Evaluator } from './contracts';
import { createNetEvaluator } from './evaluator';
import { deserializeWeights, type WeightsMeta } from './serialize';
import { decodePosition, encodePosition } from './positions';

/**
 * Self-play data generation.
 *
 * Generation 0 bootstraps from the agent we already have - ISMCTS with
 * heuristic rollouts - taking the policy target from root visit counts and the
 * value target from the reward the round actually ended on. Later generations
 * do the same with the network in the loop; nothing here needs to change for
 * that, because the search is passed in.
 *
 * Two properties matter more than speed:
 *
 * The run is RESUMABLE. Every shard is written to a temp file and renamed, so
 * a process killed mid-write cannot leave a half-record that poisons the next
 * read, and a restart replays only the shards that are missing. A twenty-hour
 * run that cannot be stopped is a twenty-hour run that has to be right first
 * time, which is not a bet worth taking.
 *
 * Positions are stored rather than features, so the encoding can change
 * without regenerating anything. See positions.ts.
 */

export interface SelfPlayConfig {
  generation: number;
  /** Games in the whole generation, split across shards. */
  games: number;
  /**
   * Simulations per decision - a FIXED COUNT, deliberately, not a time budget.
   *
   * A time budget makes self-play irreproducible: the iterations a search fits
   * into 100ms depend on machine load, so a replayed shard produces different
   * games, and a resume silently yields a different dataset than the run it
   * continues. Worse, generation runs 18 workers on 20 cores, so a wall-clock
   * budget would quietly buy weaker targets exactly when the box is busiest.
   * A fixed count costs variable time and buys constant quality, which is the
   * right way round for training data.
   */
  iterations: number;
  /**
   * Weights for the network that PLAYS these games.
   *
   * Generation 0 leaves this unset and bootstraps from ISMCTS with heuristic
   * rollouts. From generation 1 on it points at the previous generation's
   * network, and that is what makes this AlphaZero rather than a single round
   * of supervised imitation: each generation's data is produced by a player
   * that the previous generation's data made stronger.
   */
  weightsPath?: string;
  /**
   * Value calibration for the self-play network, matching what the arena uses.
   *
   * Not cosmetic: an uncalibrated network played 59 Elo worse than a calibrated
   * one, so generating a generation's data with the uncalibrated form would
   * train the next generation on the decisions of a deliberately worse player.
   */
  valueScale?: number;
  valueCenter?: number;
  /** Table sizes to sample from, so the network sees every supported size. */
  playerCounts: readonly number[];
  seed: number;
}

export const DEFAULT_SELFPLAY: SelfPlayConfig = {
  generation: 0,
  games: 64,
  // Comparable to the Ada tier's search, and deterministic.
  iterations: 400,
  // Weighted toward the sizes people actually play, but covering all of them:
  // the network is padded to seven seats and must not be ignorant of any.
  playerCounts: [6, 6, 6, 4, 5, 3, 7, 2],
  seed: 20260830,
};

export interface RawSample {
  position: Uint8Array;
  policyTarget: Float32Array;
  valueTarget: Float32Array;
  valueMask: Float32Array;
}

/** A decision recorded before the game's outcome is known. */
interface PendingSample {
  position: Uint8Array;
  policyTarget: Float32Array;
  /** Who was to move, so the value vector can be rotated to their seat. */
  mover: number;
  numPlayers: number;
}

const SHARD_MAGIC = 0x53474250; // "SGBP"
const SHARD_VERSION = 1;

/**
 * Plays one game, recording every decision worth learning from.
 *
 * Decisions with a single legal action are skipped: the search returns no visit
 * counts for them and a one-hot target over a forced move teaches nothing
 * except that the position was forced, which the legality mask already says.
 */
export function playSelfPlayGame(
  seed: number,
  numPlayers: number,
  iterations: number,
  evaluator?: Evaluator,
): RawSample[] {
  let s = createInitialState(seed, numPlayers);
  const pending: PendingSample[] = [];
  let guard = 0;

  while (!isTerminal(s)) {
    if (guard++ > 20000) throw new Error('self-play game failed to terminate');
    const actions = legalActions(s);
    if (actions.length === 0) break;

    let chosen: Action;
    if (actions.length === 1) {
      chosen = actions[0];
    } else {
      // The time budget is set far out of reach so `maxIterations` is what
      // actually stops the search, making the whole game a function of the seed.
      const result = ismctsSearch(s, s.current, {
        maxIterations: iterations,
        budgetMs: 3_600_000,
        seed: seed ^ (guard * 2654435761),
        ...(evaluator ? { evaluator } : {}),
      });
      const visits = new Float32Array(POLICY_SIZE);
      let total = 0;
      for (const rv of result.rootVisits) {
        const action = actions.find((a) => actionKey(a) === rv.key);
        if (action == null) continue;
        const idx = policyIndex(action, s.current, numPlayers);
        if (idx < 0) continue;
        visits[idx] += rv.visits;
        total += rv.visits;
      }
      if (total > 0) {
        for (let i = 0; i < POLICY_SIZE; i++) visits[i] /= total;
        pending.push({
          position: encodePosition(s),
          policyTarget: visits,
          mover: s.current,
          numPlayers,
        });
      }
      chosen = result.action;
    }
    s = applyAction(s, chosen);
  }

  // The reward the round actually ended on, which is exactly what the search
  // backs up, so the value head predicts the quantity the tree consumes.
  const finalReward = rewardVector(returns(s));
  const samples: RawSample[] = [];
  for (const p of pending) {
    const valueTarget = new Float32Array(MAX_SEATS);
    const valueMask = new Float32Array(MAX_SEATS);
    for (let seat = 0; seat < p.numPlayers; seat++) {
      const offset = toRelativeSeat(seat, p.mover, p.numPlayers);
      valueTarget[offset] = finalReward[seat];
      valueMask[offset] = 1;
    }
    samples.push({
      position: p.position,
      policyTarget: p.policyTarget,
      valueTarget,
      valueMask,
    });
  }
  return samples;
}

/**
 * Loads a network from disk for self-play, with its sidecar.
 *
 * Separate from the browser loader in load.ts because that one fetches over
 * HTTP; this reads files. Both refuse a weights file whose architecture or
 * checksum does not match, because silently loading the wrong shape would
 * produce a generation of data played by a network nobody could account for.
 */
export async function loadEvaluatorFromDisk(
  path: string,
  name = 'net',
  calibration: { valueScale?: number; valueCenter?: number } = {},
): Promise<Evaluator> {
  const fs = await checkpointFs();
  const metaPath = path.replace(/\.bin$/, '.meta.json');
  if (!fs.existsSync(path)) throw new Error(`self-play: no weights at ${path}`);
  if (!fs.existsSync(metaPath)) throw new Error(`self-play: no sidecar at ${metaPath}`);
  const meta = JSON.parse(new TextDecoder().decode(fs.readFileSync(metaPath))) as WeightsMeta;
  return createNetEvaluator(deserializeWeights(fs.readFileSync(path), meta), name, calibration);
}

/** Deterministic per-game seed, so a shard replays identically. */
export function gameSeed(config: SelfPlayConfig, index: number): number {
  return (config.seed + index * 104729) >>> 0;
}

export function playersForGame(config: SelfPlayConfig, index: number): number {
  return config.playerCounts[index % config.playerCounts.length];
}

/** Games belonging to one shard, striped so every shard sees every table size. */
export function gamesForShard(config: SelfPlayConfig, shard: number, shards: number): number[] {
  const indices: number[] = [];
  for (let i = shard; i < config.games; i += shards) indices.push(i);
  return indices;
}

export function encodeShard(samples: readonly RawSample[]): Uint8Array {
  let size = 12;
  for (const s of samples) size += 2 + s.position.length + POLICY_SIZE * 4 + MAX_SEATS * 4 + MAX_SEATS;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, SHARD_MAGIC, true);
  view.setUint32(4, SHARD_VERSION, true);
  view.setUint32(8, samples.length, true);

  let at = 12;
  for (const s of samples) {
    view.setUint16(at, s.position.length, true);
    at += 2;
    out.set(s.position, at);
    at += s.position.length;
    for (let i = 0; i < POLICY_SIZE; i++) {
      view.setFloat32(at, s.policyTarget[i], true);
      at += 4;
    }
    for (let i = 0; i < MAX_SEATS; i++) {
      view.setFloat32(at, s.valueTarget[i], true);
      at += 4;
    }
    for (let i = 0; i < MAX_SEATS; i++) out[at++] = s.valueMask[i] > 0 ? 1 : 0;
  }
  return out;
}

export function decodeShard(bytes: Uint8Array): RawSample[] {
  if (bytes.length < 12) throw new Error('shard: file is too short to hold a header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SHARD_MAGIC) {
    throw new Error('shard: bad magic; this is not a self-play shard');
  }
  const version = view.getUint32(4, true);
  if (version !== SHARD_VERSION) throw new Error(`shard: unknown format version ${version}`);
  const count = view.getUint32(8, true);

  const samples: RawSample[] = [];
  let at = 12;
  for (let n = 0; n < count; n++) {
    if (at + 2 > bytes.length) throw new Error(`shard: truncated at sample ${n} of ${count}`);
    const len = view.getUint16(at, true);
    at += 2;
    const need = len + POLICY_SIZE * 4 + MAX_SEATS * 4 + MAX_SEATS;
    if (at + need > bytes.length) throw new Error(`shard: truncated at sample ${n} of ${count}`);

    const position = bytes.slice(at, at + len);
    at += len;
    const policyTarget = new Float32Array(POLICY_SIZE);
    for (let i = 0; i < POLICY_SIZE; i++) {
      policyTarget[i] = view.getFloat32(at, true);
      at += 4;
    }
    const valueTarget = new Float32Array(MAX_SEATS);
    for (let i = 0; i < MAX_SEATS; i++) {
      valueTarget[i] = view.getFloat32(at, true);
      at += 4;
    }
    const valueMask = new Float32Array(MAX_SEATS);
    for (let i = 0; i < MAX_SEATS; i++) valueMask[i] = bytes[at++];
    samples.push({ position, policyTarget, valueTarget, valueMask });
  }
  if (at !== bytes.length) {
    throw new Error(`shard: ${bytes.length - at} trailing bytes after ${count} samples`);
  }
  return samples;
}

/**
 * Joins path segments with a forward slash.
 *
 * `node:path` is not importable here: the project deliberately omits
 * @types/node, and node accepts forward slashes on Windows regardless.
 */
const join = (...parts: string[]): string => parts.join('/');

export function generationDir(config: SelfPlayConfig, root = 'training'): string {
  return join(root, `gen${String(config.generation).padStart(3, '0')}`);
}

export function shardPath(config: SelfPlayConfig, shard: number, root = 'training'): string {
  return join(generationDir(config, root), 'shards', `shard-${String(shard).padStart(2, '0')}.bin`);
}

/**
 * Writes a file by writing a temp file and renaming it.
 *
 * Rename is atomic, so a reader either sees the previous file or the complete
 * new one and never a half-written shard. A killed run then resumes cleanly
 * instead of tripping over its own wreckage.
 */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const fs = await checkpointFs();
  const dir = path.replace(/[\/][^\/]*$/, '');
  if (dir && dir !== path) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, path);
}

/** Plays one shard's games, or returns what is already on disk. */
export async function runShard(
  config: SelfPlayConfig,
  shard: number,
  shards: number,
  root = 'training',
  onProgress?: (done: number, of: number) => void,
): Promise<{ samples: number; skipped: boolean }> {
  const fs = await checkpointFs();
  const path = shardPath(config, shard, root);
  if (fs.existsSync(path)) {
    try {
      const existing = decodeShard(fs.readFileSync(path));
      return { samples: existing.length, skipped: true };
    } catch {
      // A shard that will not parse is worse than no shard: replay it rather
      // than let a corrupt file silently shrink the training set.
      fs.rmSync(path, { recursive: false as unknown as boolean, force: true });
    }
  }

  fs.mkdirSync(join(generationDir(config, root), 'shards'), { recursive: true });
  // Loaded once per shard rather than per game: the weights do not change
  // within a generation, and a shard is 25 games.
  const evaluator = config.weightsPath
    ? await loadEvaluatorFromDisk(config.weightsPath, 'selfplay', {
        valueScale: config.valueScale,
        valueCenter: config.valueCenter,
      })
    : undefined;
  const indices = gamesForShard(config, shard, shards);
  const samples: RawSample[] = [];
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    samples.push(
      ...playSelfPlayGame(
        gameSeed(config, index),
        playersForGame(config, index),
        config.iterations,
        evaluator,
      ),
    );
    onProgress?.(i + 1, indices.length);
  }
  await writeAtomic(path, encodeShard(samples));
  return { samples: samples.length, skipped: false };
}

export interface Manifest {
  config: SelfPlayConfig;
  shards: number;
  completed: Record<string, number>;
  totalSamples: number;
  updated: string;
}

export function manifestPath(config: SelfPlayConfig, root = 'training'): string {
  return join(generationDir(config, root), 'manifest.json');
}

export async function readManifest(
  config: SelfPlayConfig,
  root = 'training',
): Promise<Manifest | null> {
  const fs = await checkpointFs();
  const path = manifestPath(config, root);
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fs.readFileSync(path))) as Manifest;
  } catch {
    return null; // A damaged manifest is rebuilt from the shards themselves.
  }
}

export async function writeManifest(manifest: Manifest, root = 'training'): Promise<void> {
  await writeAtomic(
    manifestPath(manifest.config, root),
    new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  );
}

/** Every sample in a generation, decoded, for training. */
export async function readGeneration(
  config: SelfPlayConfig,
  shards: number,
  root = 'training',
): Promise<RawSample[]> {
  const fs = await checkpointFs();
  const all: RawSample[] = [];
  for (let i = 0; i < shards; i++) {
    const path = shardPath(config, i, root);
    if (!fs.existsSync(path)) continue;
    all.push(...decodeShard(fs.readFileSync(path)));
  }
  return all;
}

/** Decodes a stored sample back into a position the trainer can encode. */
export function positionOf(sample: RawSample): GameState {
  return decodePosition(sample.position);
}

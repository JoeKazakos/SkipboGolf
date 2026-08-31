import { Net, describeArch, sameArch, type NetArch } from './net';
import { Trainer, DEFAULT_TRAIN_CONFIG, type TrainConfig } from './train';
import { checksumBytes, flattenParameters, loadParameters } from './serialize';

/**
 * Resumable training state.
 *
 * Training runs here are long and are expected to be stopped and restarted,
 * so a checkpoint has to capture EVERYTHING a resumed run needs to be
 * indistinguishable from an uninterrupted one:
 *
 *   - the weights;
 *   - both Adam moment estimates, because Adam's step size depends on the
 *     running gradient statistics and a fresh optimiser would take a very
 *     different first step;
 *   - the step count, because bias correction reads it;
 *   - the epoch, for bookkeeping and for where to pick the data up;
 *   - the trainer's RNG state, because the shuffle order of every remaining
 *     epoch follows from it;
 *   - the hyperparameters in force, so a resume cannot silently train under
 *     different settings than the run it is continuing.
 *
 * `checkpoint.test.ts` holds that to the letter: an interrupted run and an
 * uninterrupted one must end on bit-identical weights.
 *
 * ONE FILE, NOT TWO. `serialize.ts` splits weights from a JSON sidecar
 * because a shipped weight file wants to be readable. A checkpoint wants to
 * be atomic instead: rename is atomic for one file and not for two, and a
 * checkpoint whose weights and optimiser state came from different moments
 * would resume into nonsense. So the JSON header is embedded, and the whole
 * thing is written to a temp file and renamed into place.
 */

/** Bumped when the layout changes in a way an older file cannot satisfy. */
export const CHECKPOINT_FORMAT_VERSION = 1;

/** "SBGC": Skip-Bo Golf checkpoint. */
const MAGIC = 0x53424743;
const PREAMBLE_BYTES = 16; // magic, version, jsonLength, reserved.
/** Weights, first moment, second moment - each `paramCount` float32s. */
const SECTIONS = 3;

export const DEFAULT_CHECKPOINT_DIR = 'training/checkpoints';

export interface CheckpointHeader {
  formatVersion: number;
  /** Wall clock at save time. Diagnostics only; nothing resumes from it. */
  createdAt: string;
  arch: NetArch;
  config: TrainConfig;
  step: number;
  epoch: number;
  /** mulberry32 state, a uint32. */
  rngState: number;
  paramCount: number;
  sections: number;
  /** FNV-1a over the float payload. */
  checksum: number;
  note?: string;
}

export interface DecodedCheckpoint {
  header: CheckpointHeader;
  weights: Float32Array;
  moment1: Float32Array;
  moment2: Float32Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serialises a trainer's full state into one self-describing buffer. */
export function encodeCheckpoint(trainer: Trainer, note?: string): Uint8Array {
  const net = trainer.net;
  const weights = flattenParameters(net);
  const moment1 = concat(trainer.moment1, weights.length);
  const moment2 = concat(trainer.moment2, weights.length);

  const payload = new Float32Array(weights.length * SECTIONS);
  payload.set(weights, 0);
  payload.set(moment1, weights.length);
  payload.set(moment2, weights.length * 2);
  const payloadBytes = new Uint8Array(payload.buffer);

  const header: CheckpointHeader = {
    formatVersion: CHECKPOINT_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    arch: { ...net.arch, hidden: [...net.arch.hidden] },
    config: { ...trainer.config },
    step: trainer.step,
    epoch: trainer.epoch,
    rngState: trainer.rng.state >>> 0,
    paramCount: weights.length,
    sections: SECTIONS,
    checksum: checksumBytes(payloadBytes),
    ...(note === undefined ? {} : { note }),
  };

  const json = encoder.encode(JSON.stringify(header));
  // Pad the JSON so the float payload starts on a four-byte boundary. Not
  // required by the copy on the read path, but it keeps the file tidy and
  // lets an external tool map it directly.
  const jsonPadded = (json.length + 3) & ~3;
  const out = new Uint8Array(PREAMBLE_BYTES + jsonPadded + payloadBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, CHECKPOINT_FORMAT_VERSION, true);
  view.setUint32(8, json.length, true);
  view.setUint32(12, 0, true);
  out.set(json, PREAMBLE_BYTES);
  out.set(payloadBytes, PREAMBLE_BYTES + jsonPadded);
  return out;
}

/**
 * Reads a checkpoint back, refusing anything it cannot fully verify.
 *
 * A half-written or corrupt checkpoint that loads anyway is worse than one
 * that fails, because it poisons every generation trained after it and the
 * damage shows up as "the run got worse" rather than as an error. So this
 * checks magic, version, header length, JSON validity, declared architecture
 * against declared parameter count, file length, and finally a checksum over
 * the floats - and throws with a message naming the mismatch.
 */
export function decodeCheckpoint(bytes: Uint8Array): DecodedCheckpoint {
  if (bytes.length < PREAMBLE_BYTES) {
    throw new Error(`checkpoint: file is ${bytes.length} bytes, too short to hold a preamble`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(
      `checkpoint: bad magic 0x${magic.toString(16)}; this is not a Skip-Bo Golf checkpoint`,
    );
  }
  const version = view.getUint32(4, true);
  if (version !== CHECKPOINT_FORMAT_VERSION) {
    throw new Error(
      `checkpoint: format version ${version}, but this build reads ${CHECKPOINT_FORMAT_VERSION}`,
    );
  }
  const jsonLength = view.getUint32(8, true);
  const jsonPadded = (jsonLength + 3) & ~3;
  if (PREAMBLE_BYTES + jsonPadded > bytes.length) {
    throw new Error(
      `checkpoint: header claims ${jsonLength} bytes of metadata but the file is only ` +
        `${bytes.length} bytes; it was truncated mid-write`,
    );
  }

  let header: CheckpointHeader;
  try {
    header = JSON.parse(
      decoder.decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + jsonLength)),
    ) as CheckpointHeader;
  } catch (e) {
    throw new Error(`checkpoint: metadata is not valid JSON (${(e as Error).message})`);
  }
  validateHeaderShape(header);

  const arch = header.arch;
  const expectedParams = new Net(arch).parameterCount();
  if (expectedParams !== header.paramCount) {
    throw new Error(
      `checkpoint: architecture ${describeArch(arch)} has ${expectedParams} parameters but the ` +
        `header declares ${header.paramCount}`,
    );
  }
  if (header.sections !== SECTIONS) {
    throw new Error(
      `checkpoint: declares ${header.sections} payload sections, this build expects ${SECTIONS}`,
    );
  }

  const payloadStart = PREAMBLE_BYTES + jsonPadded;
  const expectedBytes = header.paramCount * SECTIONS * 4;
  const actualBytes = bytes.length - payloadStart;
  if (actualBytes !== expectedBytes) {
    throw new Error(
      `checkpoint: expected ${expectedBytes} bytes of payload, found ${actualBytes}; the file is ` +
        'truncated or has trailing junk',
    );
  }

  const payload = new Float32Array(header.paramCount * SECTIONS);
  const payloadBytes = new Uint8Array(payload.buffer);
  payloadBytes.set(bytes.subarray(payloadStart));
  const actualChecksum = checksumBytes(payloadBytes);
  if (actualChecksum !== header.checksum) {
    throw new Error(
      `checkpoint: checksum mismatch (header ${header.checksum}, payload ${actualChecksum}); ` +
        'the file is corrupt',
    );
  }

  const n = header.paramCount;
  return {
    header,
    weights: payload.slice(0, n),
    moment1: payload.slice(n, n * 2),
    moment2: payload.slice(n * 2, n * 3),
  };
}

/** A hand-edited or foreign JSON header must not reach the arithmetic. */
function validateHeaderShape(h: CheckpointHeader): void {
  const bad = (why: string): never => {
    throw new Error(`checkpoint: malformed metadata (${why})`);
  };
  if (!h || typeof h !== 'object') bad('not an object');
  const a = h.arch;
  if (!a || typeof a !== 'object') bad('missing arch');
  if (!Number.isInteger(a.inputSize) || a.inputSize <= 0) bad('bad arch.inputSize');
  if (!Array.isArray(a.hidden) || a.hidden.length === 0) bad('bad arch.hidden');
  for (const w of a.hidden) if (!Number.isInteger(w) || w <= 0) bad('bad arch.hidden width');
  if (!Number.isInteger(a.valueSize) || a.valueSize <= 0) bad('bad arch.valueSize');
  if (!Number.isInteger(a.policySize) || a.policySize <= 0) bad('bad arch.policySize');
  if (!Number.isInteger(h.paramCount) || h.paramCount <= 0) bad('bad paramCount');
  if (!Number.isInteger(h.step) || h.step < 0) bad('bad step');
  if (!Number.isInteger(h.epoch) || h.epoch < 0) bad('bad epoch');
  if (!Number.isInteger(h.rngState) || h.rngState < 0) bad('bad rngState');
  if (typeof h.checksum !== 'number') bad('bad checksum');
  if (!h.config || typeof h.config !== 'object') bad('missing config');
  for (const key of Object.keys(DEFAULT_TRAIN_CONFIG) as (keyof TrainConfig)[]) {
    if (h.config[key] === undefined) bad(`config is missing ${String(key)}`);
  }
}

/**
 * Rebuilds a trainer that will continue exactly where the saved one stopped.
 *
 * `overrides` exists for the deliberate case - dropping the learning rate
 * between runs, say - and is recorded in the next checkpoint. Anything not
 * overridden comes from the file, so a resume never quietly picks up whatever
 * defaults the current build happens to ship.
 */
export function restoreTrainer(
  decoded: DecodedCheckpoint,
  overrides: Partial<TrainConfig> = {},
): Trainer {
  const net = new Net(decoded.header.arch);
  loadParameters(net, decoded.weights);
  const trainer = new Trainer(net, { ...decoded.header.config, ...overrides });
  scatter(trainer.moment1, decoded.moment1);
  scatter(trainer.moment2, decoded.moment2);
  trainer.step = decoded.header.step;
  trainer.epoch = decoded.header.epoch;
  trainer.rng.state = decoded.header.rngState;
  return trainer;
}

/** Refuses a checkpoint whose net is not the shape the caller is training. */
export function assertArchMatches(decoded: DecodedCheckpoint, arch: NetArch): void {
  if (!sameArch(decoded.header.arch, arch)) {
    throw new Error(
      `checkpoint: file is ${describeArch(decoded.header.arch)} but this run is ` +
        `${describeArch(arch)}`,
    );
  }
}

function concat(parts: readonly Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function scatter(parts: readonly Float32Array[], flat: Float32Array): void {
  let at = 0;
  for (const p of parts) {
    p.set(flat.subarray(at, at + p.length));
    at += p.length;
  }
}

// ---------------------------------------------------------------------------
// File I/O.
//
// The project has no @types/node, and adding it to typecheck four filesystem
// calls is not worth it, so `node:fs` is reached through a dynamic import with
// a computed specifier and narrowed to the handful of functions used here.
// That also keeps the module importable from the browser bundle: nothing is
// pulled in until a save or load is actually attempted.
// ---------------------------------------------------------------------------

export interface CheckpointFs {
  mkdirSync(path: string, options: { recursive: boolean }): void;
  writeFileSync(path: string, data: Uint8Array): void;
  readFileSync(path: string): Uint8Array;
  renameSync(from: string, to: string): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

let fsPromise: Promise<CheckpointFs> | null = null;

export function checkpointFs(): Promise<CheckpointFs> {
  if (!fsPromise) {
    const specifier = 'node:' + 'fs';
    fsPromise = import(/* @vite-ignore */ specifier) as unknown as Promise<CheckpointFs>;
  }
  return fsPromise;
}

/**
 * Writes to a temp file in the same directory, then renames it into place.
 *
 * Rename within a directory is atomic, so a run killed at any point leaves
 * either the previous checkpoint or the new one, never a half-written file
 * that the next resume would try to parse. The temp file goes beside the
 * target rather than in the system temp directory because rename across
 * filesystems is a copy, and a copy is not atomic.
 */
export async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const fs = await checkpointFs();
  const dir = path.replace(/[\\/][^\\/]*$/, '');
  if (dir && dir !== path) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path);
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const fs = await checkpointFs();
  return fs.readFileSync(path);
}

/** `epoch-000007.ckpt`: zero padded so a plain sort is a chronological sort. */
export function checkpointName(epoch: number): string {
  return `epoch-${String(epoch).padStart(6, '0')}.ckpt`;
}

/**
 * Saves a checkpoint for the trainer's current epoch, and updates
 * `latest.ckpt` to the same bytes.
 *
 * Two files, but they are written independently and each is atomic, and
 * neither is a fragment of the other: if the second write is lost, `latest`
 * simply points at an older complete checkpoint and the resume is correct if
 * slightly stale. Returns the path of the epoch file.
 */
export async function saveCheckpoint(
  trainer: Trainer,
  dir: string = DEFAULT_CHECKPOINT_DIR,
  note?: string,
): Promise<string> {
  const bytes = encodeCheckpoint(trainer, note);
  const path = `${dir}/${checkpointName(trainer.epoch)}`;
  await writeFileAtomic(path, bytes);
  await writeFileAtomic(`${dir}/latest.ckpt`, bytes);
  return path;
}

export async function loadCheckpoint(path: string): Promise<DecodedCheckpoint> {
  return decodeCheckpoint(await readFileBytes(path));
}

/**
 * The newest checkpoint in a directory, or null if there is none.
 *
 * `latest.ckpt` is preferred; the epoch files are the fallback, so a run whose
 * `latest` write was the one that got killed still resumes. Callers should
 * treat null as "start from scratch" rather than as an error, since that is
 * exactly the first-run case.
 */
export async function findLatestCheckpoint(
  dir: string = DEFAULT_CHECKPOINT_DIR,
): Promise<string | null> {
  const fs = await checkpointFs();
  if (!fs.existsSync(dir)) return null;
  if (fs.existsSync(`${dir}/latest.ckpt`)) return `${dir}/latest.ckpt`;
  const epochs = fs
    .readdirSync(dir)
    .filter((f) => /^epoch-\d{6}\.ckpt$/.test(f))
    .sort();
  return epochs.length > 0 ? `${dir}/${epochs[epochs.length - 1]}` : null;
}

/**
 * Resumes from the newest checkpoint in `dir`, or starts a fresh trainer.
 *
 * This is the entry point a training script wants: the same call works for a
 * first run and for the fifth continuation, and a checkpoint whose
 * architecture does not match what the caller asked for is rejected rather
 * than adapted.
 */
export async function resumeOrCreate(
  arch: NetArch,
  config: Partial<TrainConfig> = {},
  dir: string = DEFAULT_CHECKPOINT_DIR,
  weightSeed = 1,
): Promise<{ trainer: Trainer; resumedFrom: string | null }> {
  const path = await findLatestCheckpoint(dir);
  if (path === null) {
    return { trainer: new Trainer(Net.create(arch, weightSeed), config), resumedFrom: null };
  }
  const decoded = await loadCheckpoint(path);
  assertArchMatches(decoded, arch);
  return { trainer: restoreTrainer(decoded, config), resumedFrom: path };
}

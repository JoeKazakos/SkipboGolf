import { Net, describeArch, sameArch, type NetArch } from './net';

/**
 * Weights to and from a compact binary buffer, with a JSON sidecar.
 *
 * The split is deliberate. The binary half is nothing but a small header and
 * a run of float32s, so a 400-[128,128]-head net is about 280 KB and loads
 * with a single typed-array view - no parsing, no number-to-string round trip
 * that would both bloat the file and lose the low bits of every weight. The
 * JSON half is the part a human or a script needs to read: architecture,
 * feature size, format version.
 *
 * The load path's job is to REFUSE anything it cannot honour. A weight file
 * silently loaded into the wrong shape does not crash, it just evaluates
 * garbage, and garbage from a value head looks exactly like a network that
 * trained badly. Every mismatch below throws.
 */

/** Bumped whenever the layout below changes in a way old files cannot satisfy. */
export const WEIGHTS_FORMAT_VERSION = 1;

/** "SBGW": Skip-Bo Golf weights. First four bytes of every weight file. */
const MAGIC = 0x53424757;

const HEADER_BYTES = 16; // magic, version, paramCount, checksum - four uint32s.

/** The JSON sidecar. Enough to rebuild the net and to reject the wrong one. */
export interface WeightsMeta {
  formatVersion: number;
  /** Length of the feature vector this net was trained against. */
  inputSize: number;
  hidden: number[];
  valueSize: number;
  policySize: number;
  /** Cross-check against the binary payload length. */
  paramCount: number;
  /** FNV-1a over the payload bytes; catches truncation and bit rot. */
  checksum: number;
  /** Free-form, for whoever has to work out where a file came from later. */
  note?: string;
}

/**
 * FNV-1a, 32 bit.
 *
 * Not a cryptographic hash and not trying to be: it is here to notice a file
 * that was cut off mid-write or corrupted on disk, which it does with a
 * failure probability of about one in four billion, for one pass over the
 * bytes and no dependency.
 */
export function checksumBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function metaFor(net: Net, note?: string): WeightsMeta {
  const payload = flattenParameters(net);
  return {
    formatVersion: WEIGHTS_FORMAT_VERSION,
    inputSize: net.arch.inputSize,
    hidden: [...net.arch.hidden],
    valueSize: net.arch.valueSize,
    policySize: net.arch.policySize,
    paramCount: payload.length,
    checksum: checksumBytes(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)),
    ...(note === undefined ? {} : { note }),
  };
}

export function archFromMeta(meta: WeightsMeta): NetArch {
  return {
    inputSize: meta.inputSize,
    hidden: [...meta.hidden],
    valueSize: meta.valueSize,
    policySize: meta.policySize,
  };
}

/**
 * Every parameter, concatenated in `net.tensors()` order.
 *
 * A copy, not views: the tensors are separate allocations, and one contiguous
 * run is what makes the file a single typed-array read on the way back in.
 */
export function flattenParameters(net: Net): Float32Array {
  const tensors = net.tensors();
  let total = 0;
  for (const t of tensors) total += t.data.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const t of tensors) {
    out.set(t.data, at);
    at += t.data.length;
  }
  return out;
}

/** The inverse of `flattenParameters`, straight into an existing net. */
export function loadParameters(net: Net, flat: Float32Array): void {
  const tensors = net.tensors();
  let total = 0;
  for (const t of tensors) total += t.data.length;
  if (flat.length !== total) {
    throw new Error(`weights: expected ${total} parameters, got ${flat.length}`);
  }
  let at = 0;
  for (const t of tensors) {
    t.data.set(flat.subarray(at, at + t.data.length));
    at += t.data.length;
  }
}

/** Header plus float32 payload. Little-endian, which every target here is. */
export function serializeWeights(net: Net): Uint8Array {
  const payload = flattenParameters(net);
  const payloadBytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  const out = new Uint8Array(HEADER_BYTES + payloadBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, WEIGHTS_FORMAT_VERSION, true);
  view.setUint32(8, payload.length, true);
  view.setUint32(12, checksumBytes(payloadBytes), true);
  out.set(payloadBytes, HEADER_BYTES);
  return out;
}

/**
 * Reads the payload back, checking everything checkable before it is used.
 *
 * Order matters: magic first so a wrong file type is named as such rather
 * than reported as a length mismatch, then version, then length, then
 * checksum. Each message says what was expected and what arrived, because the
 * caller is usually a training script that will not be watched.
 */
export function parseWeightsPayload(bytes: Uint8Array): Float32Array {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`weights: file is ${bytes.length} bytes, too short to hold a header`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(
      `weights: bad magic 0x${magic.toString(16)}; this is not a Skip-Bo Golf weight file`,
    );
  }
  const version = view.getUint32(4, true);
  if (version !== WEIGHTS_FORMAT_VERSION) {
    throw new Error(
      `weights: format version ${version}, but this build reads ${WEIGHTS_FORMAT_VERSION}`,
    );
  }
  const paramCount = view.getUint32(8, true);
  const expectedBytes = HEADER_BYTES + paramCount * 4;
  if (bytes.length !== expectedBytes) {
    throw new Error(
      `weights: header declares ${paramCount} parameters (${expectedBytes} bytes) but the file is ` +
        `${bytes.length} bytes; it is truncated or has trailing junk`,
    );
  }
  const payloadBytes = bytes.subarray(HEADER_BYTES);
  const checksum = view.getUint32(12, true);
  const actual = checksumBytes(payloadBytes);
  if (actual !== checksum) {
    throw new Error(`weights: checksum mismatch (file ${checksum}, data ${actual}); file is corrupt`);
  }
  // The payload is copied rather than viewed, because `bytes` may sit at an
  // offset that is not four-byte aligned and Float32Array would refuse it.
  const flat = new Float32Array(paramCount);
  new Uint8Array(flat.buffer).set(payloadBytes);
  return flat;
}

/**
 * Rebuilds a net from a sidecar and a binary payload.
 *
 * The architecture comes from the sidecar; the payload only has to agree with
 * it. That is the loud rejection the brief asks for: a file trained on a
 * 350-float encoder cannot be loaded into a 400-float net by accident.
 */
export function deserializeWeights(bytes: Uint8Array, meta: WeightsMeta): Net {
  if (meta.formatVersion !== WEIGHTS_FORMAT_VERSION) {
    throw new Error(
      `weights: sidecar format version ${meta.formatVersion}, but this build reads ` +
        `${WEIGHTS_FORMAT_VERSION}`,
    );
  }
  const flat = parseWeightsPayload(bytes);
  if (flat.length !== meta.paramCount) {
    throw new Error(
      `weights: sidecar declares ${meta.paramCount} parameters, payload holds ${flat.length}`,
    );
  }
  const net = new Net(archFromMeta(meta));
  if (net.parameterCount() !== flat.length) {
    throw new Error(
      `weights: architecture ${describeArch(net.arch)} needs ${net.parameterCount()} parameters, ` +
        `payload holds ${flat.length}`,
    );
  }
  loadParameters(net, flat);
  return net;
}

/** Loads into a net that already exists, refusing a shape it does not match. */
export function loadWeightsInto(net: Net, bytes: Uint8Array, meta: WeightsMeta): void {
  const fileArch = archFromMeta(meta);
  if (!sameArch(net.arch, fileArch)) {
    throw new Error(
      `weights: file is ${describeArch(fileArch)} but this net is ${describeArch(net.arch)}`,
    );
  }
  loadParameters(net, parseWeightsPayload(bytes));
}

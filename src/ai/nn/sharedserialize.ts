import type { GameState } from '../../engine/types';
import type { Evaluator, NetOutput } from './contracts';
import type { EvaluatorCalibration } from './evaluator';
import { encodeShared, SHARED_INPUT } from './seatfeatures';
import { checksumBytes } from './serialize';
import { DEFAULT_SHARED_ARCH, SharedNet, type SharedArch } from './sharednet';

/**
 * Weights and evaluator plumbing for the shared per-seat network.
 *
 * Deliberately separate from serialize.ts rather than generalised into it. The
 * two architectures are being trained on the same data and judged against the
 * same control, and the point of that comparison is undermined if a change made
 * for one silently alters the other. They meet only at the arena.
 */

export const SHARED_FORMAT_VERSION = 1;
const MAGIC = 0x53474e53; // "SGNS"
const HEADER_BYTES = 16;

export interface SharedMeta {
  formatVersion: number;
  arch: SharedArch;
  paramCount: number;
  checksum: number;
  note?: string;
}

export function flattenShared(net: SharedNet): Float32Array {
  const tensors = net.tensors();
  const total = tensors.reduce((n, t) => n + t.data.length, 0);
  const flat = new Float32Array(total);
  let at = 0;
  for (const t of tensors) {
    flat.set(t.data, at);
    at += t.data.length;
  }
  return flat;
}

export function loadShared(net: SharedNet, flat: Float32Array): void {
  const tensors = net.tensors();
  const total = tensors.reduce((n, t) => n + t.data.length, 0);
  if (flat.length !== total) {
    throw new Error(`shared weights: file holds ${flat.length} parameters, net wants ${total}`);
  }
  let at = 0;
  for (const t of tensors) {
    t.data.set(flat.subarray(at, at + t.data.length));
    at += t.data.length;
  }
}

export function sharedMetaFor(net: SharedNet, note?: string): SharedMeta {
  const payload = flattenShared(net);
  return {
    formatVersion: SHARED_FORMAT_VERSION,
    arch: net.arch,
    paramCount: payload.length,
    checksum: checksumBytes(
      new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
    ),
    ...(note === undefined ? {} : { note }),
  };
}

export function serializeShared(net: SharedNet): Uint8Array {
  const payload = flattenShared(net);
  const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  const out = new Uint8Array(HEADER_BYTES + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, SHARED_FORMAT_VERSION, true);
  view.setUint32(8, payload.length, true);
  view.setUint32(12, checksumBytes(bytes), true);
  out.set(bytes, HEADER_BYTES);
  return out;
}

export function deserializeShared(bytes: Uint8Array, meta: SharedMeta): SharedNet {
  if (bytes.length < HEADER_BYTES) throw new Error('shared weights: file too short for a header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('shared weights: bad magic; this is not a shared-encoder weights file');
  }
  const version = view.getUint32(4, true);
  if (version !== SHARED_FORMAT_VERSION) {
    throw new Error(`shared weights: format version ${version}, this build reads ${SHARED_FORMAT_VERSION}`);
  }
  const count = view.getUint32(8, true);
  const checksum = view.getUint32(12, true);
  const payloadBytes = bytes.subarray(HEADER_BYTES);
  if (payloadBytes.length !== count * 4) {
    throw new Error(`shared weights: header declares ${count} parameters, file holds ${payloadBytes.length / 4}`);
  }
  if (checksumBytes(payloadBytes) !== checksum) {
    throw new Error('shared weights: checksum mismatch; the file is corrupt or truncated');
  }
  if (meta.paramCount !== count) {
    throw new Error(`shared weights: sidecar says ${meta.paramCount} parameters, file holds ${count}`);
  }

  // Copy rather than view: the payload may not be 4-byte aligned in the buffer
  // it arrived in, and Float32Array demands alignment.
  const aligned = new Uint8Array(payloadBytes.length);
  aligned.set(payloadBytes);
  const net = new SharedNet(meta.arch ?? DEFAULT_SHARED_ARCH);
  loadShared(net, new Float32Array(aligned.buffer));
  return net;
}

/**
 * The shared network as something the search can ask about a position.
 *
 * Mirrors createNetEvaluator, including the value calibration and the `reveal`
 * flag, so the two architectures differ in nothing except the network.
 */
export function createSharedEvaluator(
  net: SharedNet,
  name = 'shared',
  calibration: EvaluatorCalibration = {},
): Evaluator {
  const buffer = new Float32Array(SHARED_INPUT);
  const scale = calibration.valueScale ?? 1;
  const center = calibration.valueCenter ?? 0.5;
  const reveal = calibration.reveal ?? false;

  if (scale === 1) {
    return {
      name,
      evaluate(s: GameState, viewer: number): NetOutput {
        encodeShared(s, viewer, buffer, reveal);
        return net.forward(buffer);
      },
    };
  }

  const calibrated: NetOutput = {
    value: new Float32Array(net.arch.valueSize),
    policy: new Float32Array(net.arch.policySize),
  };
  return {
    name,
    evaluate(s: GameState, viewer: number): NetOutput {
      encodeShared(s, viewer, buffer, reveal);
      const raw = net.forward(buffer);
      for (let i = 0; i < calibrated.value.length; i++) {
        const stretched = center + (raw.value[i] - center) * scale;
        calibrated.value[i] = stretched < 0 ? 0 : stretched > 1 ? 1 : stretched;
      }
      calibrated.policy.set(raw.policy);
      return calibrated;
    },
  };
}

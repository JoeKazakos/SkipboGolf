import type { Evaluator } from './contracts';
import { createNetEvaluator } from './evaluator';
import { deserializeWeights, type WeightsMeta } from './serialize';

/**
 * Loads trained weights in the browser.
 *
 * The weights live beside the app as a static file rather than inside the
 * JavaScript bundle. At 64k parameters that is about 250KB, and base64 in a
 * module would inflate the bundle everyone downloads even when they never seat
 * a network opponent. Fetching keeps it lazy and cacheable.
 *
 * Results are cached per URL because every seated opponent asks for the same
 * file, and a worker may build several agents.
 */
const cache = new Map<string, Promise<Evaluator>>();

async function fetchEvaluator(url: string, name: string): Promise<Evaluator> {
  const metaUrl = url.replace(/\.bin$/, '.meta.json');
  const [weightsResponse, metaResponse] = await Promise.all([fetch(url), fetch(metaUrl)]);
  if (!weightsResponse.ok) throw new Error(`weights: ${url} returned ${weightsResponse.status}`);
  if (!metaResponse.ok) throw new Error(`weights: ${metaUrl} returned ${metaResponse.status}`);

  const meta = (await metaResponse.json()) as WeightsMeta;
  const bytes = new Uint8Array(await weightsResponse.arrayBuffer());
  // deserializeWeights checks the architecture and the checksum, so a stale or
  // truncated file is refused here rather than becoming a network that plays
  // badly for a reason no measurement would ever reveal.
  return createNetEvaluator(deserializeWeights(bytes, meta), name);
}

export function loadEvaluatorFromUrl(url: string, name = 'Net'): Promise<Evaluator> {
  const hit = cache.get(url);
  if (hit) return hit;
  const pending = fetchEvaluator(url, name);
  cache.set(url, pending);
  // A failed load must not be cached as a permanent failure: a transient
  // network error should not disable the opponent for the rest of the session.
  pending.catch(() => cache.delete(url));
  return pending;
}

/** Forgets everything loaded. Exists for tests. */
export function clearEvaluatorCache(): void {
  cache.clear();
}

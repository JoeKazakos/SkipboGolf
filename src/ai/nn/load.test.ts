import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ARCH, Net } from './net';
import { metaFor, serializeWeights } from './serialize';
import { clearEvaluatorCache, loadEvaluatorFromUrl } from './load';

/**
 * Gates for loading weights in the browser.
 *
 * The failure that matters is the quiet one: a stale or truncated weights file
 * accepted as a network. It would not throw, it would just play badly, and no
 * arena result would ever explain why. So the checks live in the loader and
 * are asserted here.
 */

const net = Net.create(DEFAULT_ARCH, 5);
const goodBytes = serializeWeights(net);
const goodMeta = metaFor(net, 'test');

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(handler(String(url)))));
}

const okWeights = () => new Response(goodBytes.slice().buffer, { status: 200 });
const okMeta = () => new Response(JSON.stringify(goodMeta), { status: 200 });

afterEach(() => {
  clearEvaluatorCache();
  vi.unstubAllGlobals();
});

describe('loading weights over the network', () => {
  it('builds a working evaluator from weights and sidecar', async () => {
    mockFetch((url) => (url.endsWith('.meta.json') ? okMeta() : okWeights()));
    const evaluator = await loadEvaluatorFromUrl('/nets/gen000.bin', 'Gen0');
    expect(evaluator.name).toBe('Gen0');
  });

  it('fetches once for repeated requests', async () => {
    mockFetch((url) => (url.endsWith('.meta.json') ? okMeta() : okWeights()));
    await loadEvaluatorFromUrl('/nets/gen000.bin');
    await loadEvaluatorFromUrl('/nets/gen000.bin');
    await loadEvaluatorFromUrl('/nets/gen000.bin');
    // Two calls total - the weights and the sidecar - not six. Every seated
    // opponent asks for the same file.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('reports a missing weights file rather than returning a broken evaluator', async () => {
    mockFetch((url) =>
      url.endsWith('.meta.json') ? okMeta() : new Response('', { status: 404 }),
    );
    await expect(loadEvaluatorFromUrl('/nets/missing.bin')).rejects.toThrow(/404/);
  });

  it('reports a missing sidecar', async () => {
    mockFetch((url) =>
      url.endsWith('.meta.json') ? new Response('', { status: 404 }) : okWeights(),
    );
    await expect(loadEvaluatorFromUrl('/nets/nosidecar.bin')).rejects.toThrow(/404/);
  });

  it('refuses weights whose architecture is not this build"s', async () => {
    const other = Net.create({ ...DEFAULT_ARCH, hidden: [32] }, 5);
    const otherMeta = metaFor(other, 'other');
    mockFetch((url) =>
      url.endsWith('.meta.json')
        ? new Response(JSON.stringify(otherMeta), { status: 200 })
        : okWeights(),
    );
    await expect(loadEvaluatorFromUrl('/nets/mismatch.bin')).rejects.toThrow();
  });

  it('refuses a truncated weights file', async () => {
    mockFetch((url) =>
      url.endsWith('.meta.json')
        ? okMeta()
        : new Response(goodBytes.slice(0, goodBytes.length - 64).buffer, { status: 200 }),
    );
    await expect(loadEvaluatorFromUrl('/nets/truncated.bin')).rejects.toThrow();
  });

  it('does not cache a failure, so a transient error is recoverable', async () => {
    // A network blip must not disable the opponent for the rest of the
    // session, which is what caching the rejected promise would do.
    let attempt = 0;
    mockFetch((url) => {
      if (url.endsWith('.meta.json')) return okMeta();
      attempt += 1;
      return attempt === 1 ? new Response('', { status: 503 }) : okWeights();
    });
    await expect(loadEvaluatorFromUrl('/nets/flaky.bin')).rejects.toThrow();
    const evaluator = await loadEvaluatorFromUrl('/nets/flaky.bin');
    expect(evaluator.name).toBe('Net');
  });
});

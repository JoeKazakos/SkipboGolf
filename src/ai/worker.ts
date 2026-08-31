import type { Action, GameState } from '../engine/types';
import type { Agent } from './agent';
import { createIsmctsAgent, ismctsSearch, type IsmctsOptions } from './ismcts';
import type { Evaluator } from './nn/contracts';
import { loadEvaluatorFromUrl } from './nn/load';

/**
 * The ISMCTS search moved off the main thread, so a multi-second budget never
 * freezes the UI.
 *
 * This file is both the worker entry point and the main-thread client. Anything
 * that stops a real worker from being built - Node, jsdom, a bundler that did
 * not process the `new URL` form - is caught and the search simply runs
 * in-thread instead, so tests and headless callers still work.
 */

export interface ChooseRequest {
  id: number;
  type: 'choose';
  state: GameState;
  player: number;
  options: IsmctsOptions;
  /**
   * Where to fetch a trained network, if this opponent uses one.
   *
   * A URL rather than the evaluator itself, because an `Evaluator` holds
   * functions and closures and postMessage can only carry structured-cloneable
   * data. The worker loads it once and caches it.
   */
  weightsUrl?: string;
}

export interface AbortRequest {
  id: number;
  type: 'abort';
}

export type WorkerRequest = ChooseRequest | AbortRequest;

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      action: Action;
      /**
       * Visit count and mean outcome of every root action, best first. This is
       * the search's own reasoning, so an explanation built from it is what the
       * engine actually computed rather than a story told afterwards.
       * Empty when only one action was legal and no search was needed.
       */
      rootVisits: { key: string; visits: number; mean: number }[];
      iterations: number;
    }
  | { id: number; ok: false; error: string };

/** Handles one request. Exported so the in-thread fallback runs identical code. */
export function handleRequest(
  request: ChooseRequest,
  signal?: AbortSignal,
  evaluator?: Evaluator,
): WorkerResponse {
  try {
    const { action, rootVisits, iterations } = ismctsSearch(request.state, request.player, {
      ...request.options,
      ...(evaluator ? { evaluator } : {}),
      signal,
    });
    return { id: request.id, ok: true, action, rootVisits, iterations };
  } catch (error) {
    return { id: request.id, ok: false, error: (error as Error).message };
  }
}

/** True only inside a real dedicated worker, never in Node or jsdom. */
function inWorkerScope(): boolean {
  const scope = globalThis as { WorkerGlobalScope?: unknown; window?: unknown };
  return (
    typeof scope.WorkerGlobalScope !== 'undefined' &&
    typeof scope.window === 'undefined' &&
    typeof (globalThis as { postMessage?: unknown }).postMessage === 'function'
  );
}

if (inWorkerScope()) {
  const inFlight = new Map<number, AbortController>();
  const scope = globalThis as unknown as {
    postMessage(message: WorkerResponse): void;
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  };
  scope.addEventListener('message', (event: MessageEvent) => {
    const request = event.data as WorkerRequest;
    if (request.type === 'abort') {
      inFlight.get(request.id)?.abort();
      return;
    }
    const controller = new AbortController();
    inFlight.set(request.id, controller);
    void (async () => {
      let evaluator: Evaluator | undefined;
      if (request.weightsUrl) {
        try {
          evaluator = await loadEvaluatorFromUrl(request.weightsUrl);
        } catch {
          // Play on with the heuristic rather than refuse to move. A missing
          // or stale weights file makes this opponent weaker, which is a much
          // better failure than a seat that never takes its turn.
          evaluator = undefined;
        }
      }
      const response = handleRequest(request, controller.signal, evaluator);
      inFlight.delete(request.id);
      scope.postMessage(response);
    })();
  });
}

export interface WorkerAgentOptions extends IsmctsOptions {
  /** Set false to skip the worker entirely, e.g. when profiling. */
  useWorker?: boolean;
  /** Weights for a network-backed opponent; see ChooseRequest.weightsUrl. */
  weightsUrl?: string;
}

/**
 * An `Agent` that runs ISMCTS in a Web Worker where one can be built, and
 * in-thread where one cannot.
 *
 * The worker is created lazily on the first decision and reused. If it ever
 * fails - construction throws, or it reports an error event - the agent
 * permanently degrades to the in-thread search rather than leaving the caller
 * with a promise that never settles.
 */
export function createWorkerAgent(options: WorkerAgentOptions = {}): Agent {
  const { useWorker = true, weightsUrl, ...searchOptions } = options;
  let worker: Worker | null = null;
  let workerFailed = !useWorker;
  const inThread = createIsmctsAgent(searchOptions);
  let nextId = 1;

  /**
   * The in-thread fallback for a network opponent.
   *
   * Built lazily and only if the worker is unavailable, so the common path
   * never pays for it. If the weights will not load, this degrades to the
   * plain heuristic search rather than refusing to move: a weaker opponent is
   * a far better failure than a seat that never takes its turn.
   */
  let inThreadNet: Agent | null = null;
  async function inThreadAgent(): Promise<Agent> {
    if (!weightsUrl) return inThread;
    if (inThreadNet) return inThreadNet;
    try {
      const evaluator = await loadEvaluatorFromUrl(weightsUrl, options.name ?? 'net');
      inThreadNet = createIsmctsAgent({ ...searchOptions, evaluator });
    } catch {
      inThreadNet = inThread;
    }
    return inThreadNet;
  }

  function ensureWorker(): Worker | null {
    if (workerFailed) return null;
    if (worker != null) return worker;
    try {
      if (typeof Worker === 'undefined') throw new Error('Worker is not available');
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('error', () => {
        workerFailed = true;
        worker?.terminate();
        worker = null;
      });
      return worker;
    } catch {
      workerFailed = true;
      return null;
    }
  }

  return {
    name: options.name ?? 'ismcts-worker',
    async chooseAction(state, player, opts) {
      const active = ensureWorker();
      if (active == null) return (await inThreadAgent()).chooseAction(state, player, opts);

      const id = nextId++;
      const request: ChooseRequest = {
        id,
        type: 'choose',
        state,
        player,
        options: { ...searchOptions, budgetMs: opts?.budgetMs ?? searchOptions.budgetMs },
        ...(weightsUrl ? { weightsUrl } : {}),
      };

      try {
        return await new Promise<Action>((resolve, reject) => {
          const onMessage = (event: MessageEvent) => {
            const response = event.data as WorkerResponse;
            if (response.id !== id) return;
            cleanup();
            if (response.ok) resolve(response.action);
            else reject(new Error(response.error));
          };
          const onError = () => {
            cleanup();
            reject(new Error('worker failed'));
          };
          const onAbort = () => {
            active.postMessage({ id, type: 'abort' } satisfies AbortRequest);
          };
          function cleanup(): void {
            active?.removeEventListener('message', onMessage);
            active?.removeEventListener('error', onError);
            opts?.signal?.removeEventListener('abort', onAbort);
          }
          active.addEventListener('message', onMessage);
          active.addEventListener('error', onError);
          opts?.signal?.addEventListener('abort', onAbort);
          active.postMessage(request);
        });
      } catch {
        // One bad worker round trip is enough; do not risk hanging the caller again.
        workerFailed = true;
        worker?.terminate();
        worker = null;
        // The network opponent keeps its network when it falls back in-thread;
        // dropping to the plain search here would silently change who the
        // player is facing mid-game.
        return (await inThreadAgent()).chooseAction(state, player, opts);
      }
    },
  };
}

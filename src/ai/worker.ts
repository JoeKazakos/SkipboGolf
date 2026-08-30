import type { Action, GameState } from '../engine/types';
import type { Agent } from './agent';
import { createIsmctsAgent, ismctsSearch, type IsmctsOptions } from './ismcts';

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
export function handleRequest(request: ChooseRequest, signal?: AbortSignal): WorkerResponse {
  try {
    const { action, rootVisits, iterations } = ismctsSearch(request.state, request.player, {
      ...request.options,
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
    const response = handleRequest(request, controller.signal);
    inFlight.delete(request.id);
    scope.postMessage(response);
  });
}

export interface WorkerAgentOptions extends IsmctsOptions {
  /** Set false to skip the worker entirely, e.g. when profiling. */
  useWorker?: boolean;
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
  const { useWorker = true, ...searchOptions } = options;
  let worker: Worker | null = null;
  let workerFailed = !useWorker;
  const inThread = createIsmctsAgent(searchOptions);
  let nextId = 1;

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
      if (active == null) return inThread.chooseAction(state, player, opts);

      const id = nextId++;
      const request: ChooseRequest = {
        id,
        type: 'choose',
        state,
        player,
        options: { ...searchOptions, budgetMs: opts?.budgetMs ?? searchOptions.budgetMs },
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
        return inThread.chooseAction(state, player, opts);
      }
    },
  };
}

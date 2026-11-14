import type { Preferences, SolveResult } from "./lib/solver";
import type { SolveRequest, SolveResponse } from "./lib/solver/protocol";
import type { IndexedCourse } from "./lib/timing";

/**
 * The page's side of the solver worker.
 *
 * Life cycle, chosen so that stopping always works and never poisons the next run:
 * - a worker is created when a solve starts and none is alive;
 * - a finished solve leaves the worker alive for the next one;
 * - `cancel()` (the student pressed Back while it was running), a crash, or a
 *   new solve started while one is pending TERMINATES the worker and forgets
 *   it. `solve` is one long synchronous loop, so terminating is the only way
 *   to stop it. The next solve then gets a fresh worker.
 */

/** The part of `Worker` used here; tests pass a stand-in. */
export interface WorkerLike {
  postMessage(message: SolveRequest): void;
  terminate(): void;
  onmessage: ((event: { data: SolveResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
}

/** Rejection of a solve that was stopped on purpose. Not an error to show. */
export class SolveCancelled extends Error {
  constructor() {
    super("solve cancelled");
    this.name = "SolveCancelled";
  }
}

export interface SolverClient {
  /** Runs `solve` in the worker. Rejects with `SolveCancelled` when stopped, or another error when the worker failed. */
  solve(courses: IndexedCourse[], prefs: Preferences): Promise<SolveResult>;
  /** Stops the running solve, if any. Safe to call at any time. */
  cancel(): void;
  /** True while a solve is running. */
  readonly busy: boolean;
}

function browserWorker(): WorkerLike {
  return new Worker(new URL("./lib/solver/worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

export function createSolverClient(makeWorker: () => WorkerLike = browserWorker): SolverClient {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let pending: { id: number; resolve: (r: SolveResult) => void; reject: (e: Error) => void } | null = null;

  /** Kills the worker and detaches its handlers, so nothing from it can arrive later. */
  function discardWorker(): void {
    const old = worker;
    worker = null;
    if (!old) return;
    old.onmessage = null;
    old.onerror = null;
    if ("onmessageerror" in old) old.onmessageerror = null;
    try {
      old.terminate();
    } catch {
      // Already gone.
    }
  }

  function fail(error: Error): void {
    const waiting = pending;
    pending = null;
    discardWorker();
    waiting?.reject(error);
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const created = makeWorker();
    created.onmessage = (event) => {
      const message = event.data;
      // A stale answer (another id) is dropped; cannot happen after discardWorker, but costs nothing.
      if (!pending || !message || message.id !== pending.id) return;
      const waiting = pending;
      pending = null;
      if (message.type === "result") waiting.resolve(message.result);
      else {
        discardWorker();
        waiting.reject(new Error(message.message));
      }
    };
    created.onerror = (event) => {
      (event as { preventDefault?: () => void })?.preventDefault?.();
      fail(new Error((event as { message?: string })?.message || "solver worker failed"));
    };
    created.onmessageerror = () => fail(new Error("solver worker sent an unreadable message"));
    worker = created;
    return created;
  }

  return {
    get busy() {
      return pending !== null;
    },
    cancel() {
      if (pending) fail(new SolveCancelled());
    },
    solve(courses, prefs) {
      // Only one solve at a time: a newer request replaces the running one.
      if (pending) fail(new SolveCancelled());
      return new Promise<SolveResult>((resolve, reject) => {
        const id = nextId++;
        pending = { id, resolve, reject };
        try {
          ensureWorker().postMessage({ type: "solve", id, courses, prefs });
        } catch (error) {
          // The worker could not be created, or the data could not be cloned.
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

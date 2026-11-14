import { handleMessage, type SolveResponse } from "./protocol";

/**
 * The solver worker: created by the page with
 * `new Worker(new URL("./lib/solver/worker.ts", import.meta.url), { type: "module" })`.
 * One request in, one response out; all logic is in protocol.ts.
 */

/** The part of the worker global used here (the app's tsconfig has the DOM types, not the worker ones). */
interface WorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: SolveResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const response = handleMessage(event.data);
  if (response) scope.postMessage(response);
};

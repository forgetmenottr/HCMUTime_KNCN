import type { IndexedCourse } from "../timing";
import { solve } from "./solve";
import type { Preferences, SolveResult } from "./types";

/**
 * The messages between the page and the solver worker.
 *
 * `solve` can visit five million nodes, so it runs in a Web Worker and the page
 * stays responsive. Everything here is plain data that survives
 * `postMessage` (the group masks are `Uint32Array`s, which structured clone
 * copies as they are). The worker knows nothing about the language: it returns
 * the untranslated `SolveResult`.
 *
 * `id` pairs a response with its request, so a late answer to an abandoned
 * request can be recognised and dropped.
 */

export interface SolveRequest {
  type: "solve";
  id: number;
  courses: IndexedCourse[];
  prefs: Preferences;
}

export type SolveResponse =
  | { type: "result"; id: number; result: SolveResult }
  /** Something threw. `message` is for the console only: the screen shows its own translated text. */
  | { type: "error"; id: number; message: string };

export function isSolveRequest(value: unknown): value is SolveRequest {
  const m = value as Partial<SolveRequest> | null;
  return typeof m === "object" && m !== null && m.type === "solve" && typeof m.id === "number";
}

/**
 * What the worker does with one incoming message: the answer to post back, or
 * null for a message that is not a request. Never throws. Kept apart from
 * worker.ts so it can be tested without a worker.
 */
export function handleMessage(message: unknown, run: typeof solve = solve): SolveResponse | null {
  if (!isSolveRequest(message)) return null;
  try {
    return { type: "result", id: message.id, result: run(message.courses, message.prefs) };
  } catch (error) {
    return { type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) };
  }
}

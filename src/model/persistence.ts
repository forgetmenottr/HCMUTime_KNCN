import { emptyChoices, type CourseChoices } from "./choices";
import type { GroupKey } from "./preferences";

/**
 * What the app remembers in the browser: the chosen program and the step-2
 * choices. (The language is remembered by `src/i18n`, under its own key
 * "hcmutime.lang"; this layer may not import it.)
 *
 * The storage object is PASSED IN: this file never names a browser API, so it
 * runs in Node tests, and a blocked or broken storage is the caller's `null`.
 * Nothing here throws: unreadable, corrupt or outdated data loads as "nothing saved".
 *
 * **Only whitelisted fields are ever read back.** `loadState` builds its result
 * field by field, so anything else in the stored object is dropped. In
 * particular no preference object is saved or restored, which is how an old
 * whole-day selection can never reach `daysOff.days`, nor a lecturer name
 * `avoidLecturers.names` (docs/ui-change-analysis.md A3).
 */

export const STATE_STORAGE_KEY = "hcmutime.state";
/** Bump when the shape changes; a stored object with another version is ignored. */
export const STATE_VERSION = 1;

/** The part of Web Storage used here. */
export interface StateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedState {
  /** The program code chosen on step 3, or null. */
  program: string | null;
  choices: CourseChoices;
}

export function emptySavedState(): SavedState {
  return { program: null, choices: emptyChoices() };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string" && x !== "" && x.length <= 100;
const isGroupKey = (x: unknown): x is GroupKey => isText(x) && /^[^:]+:.+$/.test(x);
const unique = <T>(items: T[]): T[] => [...new Set(items)];

function readChoices(raw: unknown): CourseChoices {
  if (!isRecord(raw)) return emptyChoices();
  const locked: Record<string, string> = {};
  if (isRecord(raw.locked)) {
    for (const [code, id] of Object.entries(raw.locked)) if (isText(code) && isText(id)) locked[code] = id;
  }
  return {
    dropped: Array.isArray(raw.dropped) ? unique(raw.dropped.filter(isText)) : [],
    locked,
    excluded: Array.isArray(raw.excluded) ? unique(raw.excluded.filter(isGroupKey)) : [],
  };
}

/** The saved state, or an empty one when nothing valid is stored or storage cannot be read. */
export function loadState(store: StateStore | null | undefined): SavedState {
  try {
    const text = store?.getItem(STATE_STORAGE_KEY);
    if (typeof text !== "string") return emptySavedState();
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw.v !== STATE_VERSION) return emptySavedState();
    return { program: isText(raw.program) ? raw.program : null, choices: readChoices(raw.choices) };
  } catch {
    return emptySavedState();
  }
}

/** Saves the state; a blocked or full storage is ignored (the choices then last for this page only). */
export function saveState(store: StateStore | null | undefined, state: SavedState): void {
  try {
    // Written field by field for the same reason it is read that way: nothing rides along.
    const clean = loadStateFrom({ v: STATE_VERSION, program: state.program, choices: state.choices });
    store?.setItem(STATE_STORAGE_KEY, JSON.stringify({ v: STATE_VERSION, program: clean.program, choices: clean.choices }));
  } catch {
    // Nothing to do.
  }
}

function loadStateFrom(raw: Record<string, unknown>): SavedState {
  return { program: isText(raw.program) ? raw.program : null, choices: readChoices(raw.choices) };
}

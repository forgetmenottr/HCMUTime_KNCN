import type { Preferences } from "../lib/solver";
import type { IndexedCourse } from "../lib/timing";
import { groupChoicesFor, includedCourses, restrictToProgram, type CourseChoices } from "./choices";
import { buildPreferences, type PreferencesState } from "./preferences";

/** The two arguments of `solve`, exactly as the app sends them. */
export interface SolveInput {
  courses: IndexedCourse[];
  prefs: Preferences;
}

/**
 * Everything between the screens' state and `solve`, in one place, so the app
 * and the tests cannot build the request differently:
 * 1. only the ticked courses (G2);
 * 2. `locked` / `excluded` limited to what exists in the pasted data;
 * 3. the complete `Preferences` object (A2);
 * 4. each course limited to the chosen program's groups (A4, generalised: see `restrictToProgram`).
 *
 * Null while no program is chosen.
 */
export function buildSolveInput(pasted: readonly IndexedCourse[], choices: CourseChoices, state: PreferencesState): SolveInput | null {
  const groupChoices = groupChoicesFor(pasted, choices);
  const prefs = buildPreferences(state, groupChoices);
  if (!prefs || typeof state.program !== "string") return null;
  return { courses: restrictToProgram(includedCourses(pasted, choices), state.program, groupChoices), prefs };
}

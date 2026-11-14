import type { Day } from "../lib/parser";
import type { Mode } from "../lib/solver";
import { GRID_DAYS, GRID_PARTS, validCells, type GridCell, type PreferencesState } from "./preferences";

/**
 * State transitions of the "Ngày/buổi nghỉ" grid.
 *
 * These are what the screen calls when the student clicks a cell. Each returns a
 * NEW state and leaves its input alone. They are kept apart from
 * `buildPreferences` on purpose: the builder is a pure mapping from state to
 * payload, and everything that *changes* the state lives here.
 */

/** The mode a first tick switches the grid to (decided 2026-11-14; docs/ui-change-analysis.md B2). */
export const FIRST_TICK_MODE: Mode = "required";

/** State of a day's "Cả ngày" cell: derived from Sáng and Chiều, never stored. */
export type DayState = "none" | "partial" | "all";

export function dayState(cells: readonly GridCell[], day: Day): DayState {
  const ticked = validCells(cells).filter((c) => c.day === day).length;
  return ticked === 0 ? "none" : ticked === GRID_PARTS.length ? "all" : "partial";
}

/** Cells in a fixed order (day, then morning → afternoon), so equal grids are equal arrays. */
function canonical(cells: readonly GridCell[]): GridCell[] {
  return validCells(cells).sort(
    (a, b) => a.day - b.day || GRID_PARTS.indexOf(a.part) - GRID_PARTS.indexOf(b.part),
  );
}

/**
 * Every change to the ticked cells goes through here, so the rule below cannot be
 * bypassed.
 *
 * **The first tick on an empty grid switches mode "Tắt" to "Bắt buộc".** Ticking a
 * cell and seeing nothing happen reads as a broken app (the time-of-day slider
 * jumping to 5 in B5 is the same idea); "Bắt buộc" rather than "Ưu tiên" because
 * someone blocking a morning usually means it.
 *
 * Two consequences, both deliberate:
 * - **Unticking the last cell does not switch the mode back.** The stored mode
 *   stays; `effectiveMode` sends "off" while the grid is empty (B8, rule 2).
 * - **Only "Tắt" is replaced.** A student who had chosen "Ưu tiên" (or "Bắt buộc")
 *   keeps it: for them a tick already does something, or, when the switch is off,
 *   the "Đang tạm tắt" note says why it does not. Overwriting a choice they made
 *   would be the surprise.
 */
function withCells(state: PreferencesState, cells: readonly GridCell[]): PreferencesState {
  const wasEmpty = validCells(state.partsOff.cells).length === 0;
  const next = canonical(cells);
  const mode = wasEmpty && next.length > 0 && state.partsOff.mode === "off" ? FIRST_TICK_MODE : state.partsOff.mode;
  return { ...state, partsOff: { mode, cells: next } };
}

/** Ticks or unticks one Sáng / Chiều cell. A cell that is not on the grid changes nothing. */
export function toggleCell(state: PreferencesState, cell: GridCell): PreferencesState {
  const [clean] = validCells([cell]);
  if (!clean) return state;
  const current = validCells(state.partsOff.cells);
  const isTicked = current.some((c) => c.day === clean.day && c.part === clean.part);
  const next = isTicked ? current.filter((c) => !(c.day === clean.day && c.part === clean.part)) : [...current, clean];
  return withCells(state, next);
}

/**
 * The "Cả ngày" cell (B2): nothing ticked or only one of the two → ticks both;
 * both ticked → unticks both. The evening part is not touched here: it is derived
 * from the two cells when the payload is built.
 */
export function toggleWholeDay(state: PreferencesState, day: Day): PreferencesState {
  if (!GRID_DAYS.includes(day)) return state;
  const current = validCells(state.partsOff.cells);
  const others = current.filter((c) => c.day !== day);
  if (dayState(current, day) === "all") return withCells(state, others);
  return withCells(state, [...others, ...GRID_PARTS.map((part): GridCell => ({ day, part }))]);
}

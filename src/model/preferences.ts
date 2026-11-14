import type { Day } from "../lib/parser";
import {
  DEFAULT_MAX_NODES,
  DEFAULT_PREFERENCES,
  MAX_WEIGHT,
  type DayPartOff,
  type Mode,
  type Preferences,
} from "../lib/solver";

/**
 * The Preferences builder: the step-3 screen's own state in, the complete
 * `Preferences` object that `solve` expects out.
 *
 * Pure: no React, no browser APIs, no translated text. The rules it encodes are
 * decided in docs/ui-change-analysis.md (A2, A3, B2, B3, B8) and
 * docs/data-contract.md (Note A, G3, G16).
 */

// ---------------------------------------------------------------------------
// State of the step-3 screen
// ---------------------------------------------------------------------------

/** The two rows the "Ngày/buổi nghỉ" grid shows. Evening has no row (see `partsOffFromCells`). */
export const GRID_PARTS = ["morning", "afternoon"] as const;
export type GridPart = (typeof GRID_PARTS)[number];

/** One ticked cell of the "Ngày/buổi nghỉ" grid. */
export interface GridCell {
  day: Day;
  part: GridPart;
}

/** What the student has done on the step-3 screen. Nothing here is derived. */
export interface PreferencesState {
  /** The one chosen program code, or null until the student chooses (no default: B2). */
  program: string | null;
  /** The "Tính cả các mục “Ưu tiên”" switch. */
  preferredSwitch: boolean;
  /**
   * Ticked cells and the mode the student picked for the whole grid.
   * The "Cả ngày" row is not stored: it is read off the two cells below it.
   */
  partsOff: { mode: Mode; cells: GridCell[] };
  freeSeats: { mode: Mode };
  /** Radio (Sáng / Chiều / Không) and its slider. The slider keeps its value while the radio says "Không". */
  timeOfDay: { prefer: "none" | "morning" | "afternoon"; weight: number };
  /** Slider 0..10. */
  fewerDays: number;
  /** Slider 0..10. */
  avoidEarly: number;
  /** "Hiển thị {n} phương án": the stepper's current value. */
  topK: number;
}

/**
 * A group key as `excluded` takes it: "CO2007:A01_A01". The template type makes
 * the compiler reject a bare group id here (G16).
 */
export type GroupKey = `${string}:${string}`;

/**
 * What step 2 decided. Required on purpose: building without it would silently
 * drop every lock and exclusion (B8, rule 1).
 *
 * The two fields use DIFFERENT id formats (G16):
 * - `locked` maps a course code to a BARE group id: `{ CO2007: "A01_A01" }`;
 * - `excluded` holds FULL keys: `["CO2007:A01_A01"]`.
 */
export interface GroupChoices {
  locked: Record<string, string>;
  excluded: GroupKey[];
}

/** The state of a freshly opened step-3 screen. Defaults come from DEFAULT_PREFERENCES (B intro). */
export function initialPreferencesState(program: string | null = null): PreferencesState {
  return {
    program,
    preferredSwitch: true, // B2: on by default
    partsOff: { mode: "off", cells: [] },
    freeSeats: { mode: "off" },
    timeOfDay: { prefer: "none", weight: 0 },
    fewerDays: DEFAULT_PREFERENCES.weights.fewerDays,
    avoidEarly: DEFAULT_PREFERENCES.weights.avoidEarly,
    topK: DEFAULT_PREFERENCES.topK,
  };
}

// ---------------------------------------------------------------------------
// What the screen shows and what is sent: the effective mode of a control
// ---------------------------------------------------------------------------

/** The two controls of block 2 that have a three-state selector. */
export type ModeControl = "partsOff" | "freeSeats";

/** The seven columns of the grid: 2 = Thứ 2 … 7 = Thứ 7, 8 = Chủ nhật. */
export const GRID_DAYS: readonly Day[] = [2, 3, 4, 5, 6, 7, 8];
const DAYS = GRID_DAYS;
const isDay = (x: unknown): x is Day => DAYS.includes(x as Day);
const isGridPart = (x: unknown): x is GridPart => GRID_PARTS.includes(x as GridPart);

/** Restored state may be stale or hand-edited: anything that is not a morning/afternoon cell on a real day is dropped, and duplicates collapse. */
export function validCells(cells: readonly GridCell[]): GridCell[] {
  const seen = new Set<string>();
  const out: GridCell[] = [];
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (!isDay(cell?.day) || !isGridPart(cell?.part)) continue;
    const key = `${cell.day}:${cell.part}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day: cell.day, part: cell.part });
  }
  return out;
}

const validMode = (x: unknown): Mode => (x === "required" || x === "preferred" ? x : "off");

/**
 * The mode `solve` is given for a control.
 *
 * - **Where the memory lives (B3).** The stored `mode` is what the student
 *   chose, so "preferred" stays in the state while the switch is off. That
 *   stored value *is* the remembered one: turning the switch back on restores
 *   it with no extra field. If the student picks another mode meanwhile, the
 *   stored value changes and the memory is gone, as B3 asks.
 * - **Switch off:** a control stored as "preferred" is sent as "off".
 * - **Empty grid (B8, rule 2):** "Ngày/buổi nghỉ" with no ticked cell is sent as
 *   "off", whatever is stored.
 */
export function effectiveMode(state: PreferencesState, control: ModeControl): Mode {
  const chosen = validMode(state[control].mode);
  if (control === "partsOff" && validCells(state.partsOff.cells).length === 0) return "off";
  if (chosen === "preferred" && !state.preferredSwitch) return "off";
  return chosen;
}

/**
 * True when the selector must say "Đang tạm tắt (trước đó: Ưu tiên)": the
 * student's choice is "preferred" and only the switch keeps it from applying.
 */
export function isPaused(state: PreferencesState, control: ModeControl): boolean {
  return validMode(state[control].mode) === "preferred" && !state.preferredSwitch;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/** UI limit for the "phương án" stepper (B7). `solve` itself takes any integer >= 1. */
export const TOP_K_MIN = 1;
export const TOP_K_MAX = 10;

/** Weight of every "preferred" item while the switch is on (B3). */
export const PREFERRED_ITEMS_WEIGHT = 5;

/** A slider value as `solve` will see it: 0..10, and 0 for anything that is not a finite number. */
export function clampWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_WEIGHT, Math.max(0, value)) : 0;
}

function clampTopK(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PREFERENCES.topK;
  return Math.min(TOP_K_MAX, Math.max(TOP_K_MIN, Math.floor(value)));
}

/**
 * Cells → `partsOff.parts`, sorted by day then morning → afternoon → evening.
 *
 * **The evening rule (B2).** When both cells of a day are ticked ("Cả ngày"),
 * the day also gets `{ day, part: "evening" }`, although the grid has no
 * evening row. Ticking a whole day means "no class at all that day"; without
 * the third part, periods 13–16 would slip through. The evening entry is never
 * stored: it is recomputed from the two cells every time, so unticking one
 * cell removes it.
 */
function partsOffFromCells(cells: readonly GridCell[]): DayPartOff[] {
  const ticked = new Set(validCells(cells).map((c) => `${c.day}:${c.part}`));
  const parts: DayPartOff[] = [];
  for (const day of DAYS) {
    const morning = ticked.has(`${day}:morning`);
    const afternoon = ticked.has(`${day}:afternoon`);
    if (morning) parts.push({ day, part: "morning" });
    if (afternoon) parts.push({ day, part: "afternoon" });
    if (morning && afternoon) parts.push({ day, part: "evening" });
  }
  return parts;
}

/**
 * The complete `Preferences` for `solve`, or **null while no program is chosen**
 * (the "Xếp lịch" button is disabled then; an empty `allowed` list would filter
 * nothing, which is not what "required" means: B8).
 *
 * Always a fresh object that shares nothing with its inputs.
 */
export function buildPreferences(state: PreferencesState, choices: GroupChoices): Preferences | null {
  const program = state.program;
  if (typeof program !== "string" || program === "") return null;

  // Start from the defaults, because a MISSING field does not fall back to them:
  // normalizePreferences turns a missing weight into 0, a missing mode into "off"
  // and a missing list into [] (Note A, G3). Every field below is then set
  // explicitly, so a later change to a default cannot change what the UI sends.
  const p = structuredClone(DEFAULT_PREFERENCES);

  // Always required, exactly one code (A1). Never an empty list.
  p.programs = { mode: "required", allowed: [program] };

  // ---- Hidden constraints (A1, B4). Off, and with the list that is safe if the mode is ever switched on by mistake. ----
  // The safe list depends on what the list MEANS (A3):
  //   * "allowed" lists (campuses, language) say what is permitted. If the mode were
  //     switched on, an EMPTY list would reject every group, so they stay FULL.
  //   * "forbidden" lists (daysOff, avoidLecturers) say what is banned. If the mode were
  //     switched on, a leftover entry would start rejecting groups, so they stay EMPTY.
  // avoidLecturers.names has a second reason: the "teaches an avoided lecturer" flag is part
  // of the equivalence key whatever the mode, so a non-empty list would stop identical groups
  // from being merged into alternatives even while the constraint is off.
  p.campuses = { mode: "off", allowed: [1, 2] };
  p.language = { mode: "off", allowed: ["V", "TA"] };
  p.daysOff = { mode: "off", days: [] };
  p.avoidLecturers = { mode: "off", names: [] };

  // ---- Block 2 ----
  p.partsOff = { mode: effectiveMode(state, "partsOff"), parts: partsOffFromCells(state.partsOff.cells) };
  p.freeSeats = { mode: effectiveMode(state, "freeSeats") };

  // ---- Step 2 carries over, in its two formats (G16). Copied, not shared. ----
  p.locked = { ...choices.locked };
  p.excluded = [...choices.excluded];

  // ---- Weights ----
  const prefer = state.timeOfDay?.prefer;
  const timeOfDay = prefer === "morning" || prefer === "afternoon" ? prefer : "none";
  p.weights = {
    // With "Không" the weight is sent as 0: `solve` ignores it then, and the share
    // shown on screen (B6) leaves the row out, so the payload says the same.
    timeOfDay: { prefer: timeOfDay, weight: timeOfDay === "none" ? 0 : clampWeight(state.timeOfDay?.weight) },
    fewerDays: clampWeight(state.fewerDays),
    compactDays: 0, // hidden; the default is 3, so it must be overwritten (B4)
    noCampusSwitch: 0, // hidden; the default is 5, so it must be overwritten (B4)
    avoidEarly: clampWeight(state.avoidEarly),
    preferredItems: state.preferredSwitch ? PREFERRED_ITEMS_WEIGHT : 0,
  };

  p.topK = clampTopK(state.topK); // a real number, never a string
  p.maxNodes = DEFAULT_MAX_NODES; // hidden (B7)
  return p;
}

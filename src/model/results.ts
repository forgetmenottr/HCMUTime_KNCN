import type { Day } from "../lib/parser";
import type { Schedule, SolveResult, SolverDiagnostic } from "../lib/solver";
import type { IndexedCourse } from "../lib/timing";

/**
 * The results view-model: a raw `SolveResult` in, what step 4 renders out.
 *
 * Pure, and free of translated text: chips and messages stay `{ code, params }`
 * (or `{ item, courses }`), and the screen translates them when it renders, so
 * switching language never re-runs anything.
 *
 * Decisions encoded here (docs/data-contract.md §5 Screen 4, §6; docs/ui-change-analysis.md A4, A6):
 * - `course-no-program` is its own state: that run's relaxed schedules are NOT shown (A4);
 * - NO option that breaks the program constraint is ever shown, whatever made the solver
 *   relax (A4, generalised): a schedule with a group of another program cannot be registered;
 * - empty input is its own state, although `solve` answers status "ok" (G11);
 * - `stats.truncated` is surfaced here, because no diagnostic carries it when schedules were found (G10);
 * - `alternatives` keys are resolved to group ids against `IndexedCourse.groups` (G12);
 * - a tab whose penalty equals the previous tab's is a tie;
 * - the grid has rows 1–12, plus 13–16 only when a picked session uses them.
 */

// ---------------------------------------------------------------------------
// The four states of the screen
// ---------------------------------------------------------------------------

/** One course the chosen program has no group for (A4). `allowed` / `available` are arrays, as `ui()` needs them. */
export interface NoProgramCourse {
  course: string;
  allowed: string[];
  available: string[];
}

/** One violation chip: a constraint name and the courses that break it. Translated by `results.violation`. */
export interface ViolationChip {
  item: string;
  courses: string[];
}

/** One row of "Các lớp cần đăng ký". */
export interface RegisterEntry {
  courseCode: string;
  groupId: string;
  /** registered >= capacity: the "Hết chỗ" chip. */
  full: boolean;
  /** Group IDS (not keys) that give the same timetable: "Cũng được: …". */
  alternatives: string[];
}

/** One session of a picked group, as the grid needs it. */
export interface PlacedSession {
  courseCode: string;
  groupId: string;
  day: Day;
  periods: number[];
  weeks: number[];
  kind: "theory" | "lab";
  /** The course is named by one of the option's violations. */
  violating: boolean;
}

/** One tab. */
export interface OptionView {
  /** 1-based: "Phương án {n}". */
  n: number;
  /** The first tab: "Phù hợp nhất". */
  best: boolean;
  /** Same penalty as the tab before it: "Ngang nhau". */
  tie: boolean;
  chips: ViolationChip[];
  entries: RegisterEntry[];
  sessions: PlacedSession[];
  /** Every week in which a picked session meets, ascending: the range of the week selector. */
  weeks: number[];
  /** Period rows of the grid: 1–12, or 1–16 when a picked session uses 13–16. */
  rows: number[];
}

export type ResultsView =
  /** Nothing was sent to `solve` (G11). Text: `results.empty`. */
  | { kind: "empty" }
  /** At least one course has no group in the chosen program (A4): no tabs, no grid; offer to drop each course. */
  | { kind: "noProgram"; courses: NoProgramCourse[] }
  /**
   * No schedule to show: title `results.infeasibleTitle` and the diagnostics.
   * `outsideProgram`: the solver did return schedules, but every one used a group of
   * another program, so none is shown; the screen says so (`results.outsideProgram`).
   */
  | { kind: "infeasible"; diagnostics: SolverDiagnostic[]; outsideProgram: boolean }
  | {
      kind: "schedules";
      /** Required items were turned into penalties: show the banner. */
      relaxed: boolean;
      /** For the banner's details (or a note, when not relaxed). `course-no-program` never appears here. */
      diagnostics: SolverDiagnostic[];
      options: OptionView[];
      /** The node budget ran out although schedules were found (G10): `results.truncated`. */
      truncated: boolean;
      ms: number;
    };

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** The last period of the afternoon; rows after it appear only when used. */
export const LAST_DAY_ROW = 12;
export const LAST_ROW = 16;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []);

/** The constraint whose violation makes a schedule impossible to register. */
export const PROGRAM_CONSTRAINT = "programs";

/** True when a picked group belongs to another program than the student's. */
export const breaksProgram = (schedule: Schedule): boolean => schedule.violations.some((v) => v.item === PROGRAM_CONSTRAINT);

/** Penalties are sums of floats; two that differ by rounding noise are still a tie. */
const samePenalty = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

function optionView(schedule: Schedule, index: number, previous: Schedule | undefined, ids: ReadonlyMap<string, string>): OptionView {
  const chips = schedule.violations.map((v) => ({ item: v.item, courses: [...v.courses] }));
  const violating = new Set(chips.flatMap((chip) => chip.courses));
  const weeks = new Set<number>();
  let late = false;

  const sessions: PlacedSession[] = [];
  const entries: RegisterEntry[] = [];
  for (const pick of schedule.picks) {
    const group = pick.group.group;
    entries.push({
      courseCode: pick.courseCode,
      groupId: group.id,
      full: group.registered >= group.capacity,
      // A key that is not in the pasted data (impossible today) still shows its id part rather than vanishing.
      alternatives: pick.alternatives.map((key) => ids.get(key) ?? key.slice(key.indexOf(":") + 1)),
    });
    for (const s of group.sessions) {
      const periods = s.periods.filter((p) => Number.isInteger(p) && p >= 1 && p <= LAST_ROW).sort((a, b) => a - b);
      if (periods.length === 0 || s.weeks.length === 0) continue;
      for (const week of s.weeks) weeks.add(week);
      if (periods[periods.length - 1] > LAST_DAY_ROW) late = true;
      sessions.push({
        courseCode: pick.courseCode,
        groupId: group.id,
        day: s.day,
        periods,
        weeks: [...s.weeks],
        kind: s.kind,
        violating: violating.has(pick.courseCode),
      });
    }
  }

  return {
    n: index + 1,
    best: index === 0,
    tie: previous !== undefined && samePenalty(previous.penalty, schedule.penalty),
    chips,
    entries,
    sessions,
    weeks: [...weeks].sort((a, b) => a - b),
    rows: range(1, late ? LAST_ROW : LAST_DAY_ROW),
  };
}

/**
 * @param result  what the worker returned, untouched
 * @param courses the courses that were sent to `solve` (to resolve `alternatives`)
 */
export function buildResultsView(result: SolveResult, courses: readonly IndexedCourse[]): ResultsView {
  const details = Array.isArray(result?.diagnosticDetails) ? result.diagnosticDetails : [];
  const returned = Array.isArray(result?.schedules) ? result.schedules : [];
  // A4, generalised: an option with a group outside the student's program is never shown.
  const schedules = returned.filter((schedule) => !breaksProgram(schedule));

  // A4 comes first, whatever the status: these courses cannot be taken in the chosen
  // program, so the run's schedules (relaxed, with an out-of-program group) are not shown.
  const noProgram = details
    .filter((d) => d.code === "course-no-program")
    .map((d): NoProgramCourse => ({
      course: String(d.params?.course ?? ""),
      allowed: strings(d.params?.allowed),
      available: strings(d.params?.available),
    }));
  if (noProgram.length > 0) return { kind: "noProgram", courses: noProgram };

  if (schedules.length === 0) {
    // G11: `solve` answers "ok" for an empty course list. Anything else without a schedule is infeasible.
    const empty = details.some((d) => d.code === "no-courses") || (result?.status === "ok" && details.length === 0);
    if (empty) return { kind: "empty" };
    const outsideProgram = returned.length > 0;
    // "relaxed" announces "the options below"; with none left to show, the line would point at nothing.
    const diagnostics = outsideProgram ? details.filter((d) => d.code !== "relaxed") : [...details];
    return { kind: "infeasible", diagnostics, outsideProgram };
  }

  const ids = new Map<string, string>();
  for (const course of courses) for (const g of course.groups) ids.set(g.key, g.group.id);

  return {
    kind: "schedules",
    relaxed: result.status === "relaxed",
    diagnostics: [...details],
    options: schedules.map((schedule, i) => optionView(schedule, i, schedules[i - 1], ids)),
    truncated: result.stats?.truncated === true,
    ms: typeof result.stats?.ms === "number" ? result.stats.ms : 0,
  };
}

// ---------------------------------------------------------------------------
// The grid: one week, or all weeks at once
// ---------------------------------------------------------------------------

/** One line inside a block: a course and the group picked for it. */
export interface BlockEntry {
  courseCode: string;
  groupId: string;
  kind: "theory" | "lab";
  violating: boolean;
  /** The weeks this entry meets in the block's periods (for a tooltip). */
  weeks: number[];
}

/** One rectangle of the grid: a day and an unbroken run of periods. */
export interface GridBlock {
  day: Day;
  /** First and last period, inclusive. */
  from: number;
  to: number;
  entries: BlockEntry[];
  /**
   * Two or more groups share these periods. The solver only allows that when
   * they never meet in the same week, so this is "Xen kẽ tuần", not a clash.
   * Only possible in the all-weeks view.
   */
  alternating: boolean;
}

export interface GridView {
  rows: number[];
  blocks: GridBlock[];
  /** Days that have at least one block in this view; the other column titles are dimmed. */
  activeDays: Day[];
}

/** Splits sorted periods into unbroken runs: [2,3,4,8,9] → [[2,4],[8,9]]. */
function runs(periods: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of periods) {
    const last = out[out.length - 1];
    if (last && p <= last[1] + 1) last[1] = Math.max(last[1], p);
    else out.push([p, p]);
  }
  return out;
}

/**
 * The blocks to draw.
 * @param week a week number for "Theo tuần" (only sessions that meet that week), or null for "Tất cả".
 */
export function gridFor(option: OptionView, week: number | null): GridView {
  const pieces: { day: Day; from: number; to: number; entry: BlockEntry }[] = [];
  for (const s of option.sessions) {
    if (week !== null && !s.weeks.includes(week)) continue;
    const entry: BlockEntry = { courseCode: s.courseCode, groupId: s.groupId, kind: s.kind, violating: s.violating, weeks: s.weeks };
    for (const [from, to] of runs(s.periods)) pieces.push({ day: s.day, from, to, entry });
  }
  pieces.sort((a, b) => a.day - b.day || a.from - b.from || a.to - b.to);

  // Pieces of one day whose periods overlap become one block.
  const blocks: GridBlock[] = [];
  for (const piece of pieces) {
    const last = blocks[blocks.length - 1];
    if (last && last.day === piece.day && piece.from <= last.to) {
      last.to = Math.max(last.to, piece.to);
      if (!last.entries.some((e) => e.courseCode === piece.entry.courseCode && e.groupId === piece.entry.groupId)) {
        last.entries.push(piece.entry);
      }
    } else {
      blocks.push({ day: piece.day, from: piece.from, to: piece.to, entries: [piece.entry], alternating: false });
    }
  }
  for (const block of blocks) block.alternating = block.entries.length > 1;

  return { rows: option.rows, blocks, activeDays: [...new Set(blocks.map((b) => b.day))] };
}

// ---------------------------------------------------------------------------
// The week selector
// ---------------------------------------------------------------------------

/** The week "Theo tuần" opens on: the first week with a session, or null when the option has none. */
export function firstWeek(option: OptionView): number | null {
  return option.weeks.length > 0 ? option.weeks[0] : null;
}

/**
 * The week ‹ (-1) or › (+1) leads to, or null at either end (the button is then disabled).
 * Weeks without any session are skipped: `option.weeks` only lists weeks that have one.
 */
export function neighbourWeek(option: OptionView, week: number | null, step: -1 | 1): number | null {
  if (week === null) return null;
  const candidates = option.weeks.filter((w) => (step > 0 ? w > week : w < week));
  if (candidates.length === 0) return null;
  return step > 0 ? candidates[0] : candidates[candidates.length - 1];
}

/**
 * The week to show after switching tab: the same week when the new option meets
 * in it, else the nearest week that it does meet in.
 */
export function clampWeek(option: OptionView, week: number | null): number | null {
  if (option.weeks.length === 0) return null;
  if (week === null) return option.weeks[0];
  return option.weeks.reduce((best, w) => (Math.abs(w - week) < Math.abs(best - week) ? w : best), option.weeks[0]);
}

import { PROGRAM_CODES, programOf } from "../lib/parser";
import type { IndexedCourse } from "../lib/timing";
import type { GroupChoices, GroupKey } from "./preferences";

/**
 * What the student decides on step 2 ("Môn và lớp"), and the pure functions the
 * screen calls when they click. Every function returns a NEW object.
 *
 * `solve` schedules every course it is given (docs/data-contract.md G2), so
 * leaving a course out is done here, by filtering the array before the call.
 */

/** Step-2 state. This is also what is saved in the browser (see persistence.ts). */
export interface CourseChoices {
  /** Codes of courses whose "Xếp lịch cho môn này" box is UNticked. Every other course is included. */
  dropped: string[];
  /** Course code → BARE group id ("Chỉ học lớp này"), one per course (G16). */
  locked: Record<string, string>;
  /** FULL group keys "CO2007:A01_A01" ("Không học lớp này") (G16). */
  excluded: GroupKey[];
}

export function emptyChoices(): CourseChoices {
  return { dropped: [], locked: {}, excluded: [] };
}

export const groupKey = (courseCode: string, groupId: string): GroupKey => `${courseCode}:${groupId}`;

export function isIncluded(choices: CourseChoices, courseCode: string): boolean {
  return !choices.dropped.includes(courseCode);
}

export function isLocked(choices: CourseChoices, courseCode: string, groupId: string): boolean {
  return choices.locked[courseCode] === groupId;
}

export function isExcluded(choices: CourseChoices, courseCode: string, groupId: string): boolean {
  return choices.excluded.includes(groupKey(courseCode, groupId));
}

/** Ticks or unticks the course's "Xếp lịch cho môn này" box. */
export function toggleCourse(choices: CourseChoices, courseCode: string): CourseChoices {
  const dropped = isIncluded(choices, courseCode)
    ? [...choices.dropped, courseCode]
    : choices.dropped.filter((code) => code !== courseCode);
  return { ...choices, dropped };
}

/** Leaves the course out (the "Bỏ môn này và xếp lại" button of the results screen). */
export function dropCourse(choices: CourseChoices, courseCode: string): CourseChoices {
  return isIncluded(choices, courseCode) ? toggleCourse(choices, courseCode) : choices;
}

/**
 * "Chỉ học lớp này": locks the group, or unlocks it when it is the locked one.
 * A group cannot be both locked and excluded (the solver would answer
 * `locked-excluded`), so locking a group removes its exclusion.
 */
export function toggleLock(choices: CourseChoices, courseCode: string, groupId: string): CourseChoices {
  const locked = { ...choices.locked };
  if (locked[courseCode] === groupId) {
    delete locked[courseCode];
    return { ...choices, locked };
  }
  locked[courseCode] = groupId;
  const key = groupKey(courseCode, groupId);
  return { ...choices, locked, excluded: choices.excluded.filter((k) => k !== key) };
}

/** "Không học lớp này": excludes the group, or brings it back. Excluding the locked group unlocks it. */
export function toggleExclude(choices: CourseChoices, courseCode: string, groupId: string): CourseChoices {
  const key = groupKey(courseCode, groupId);
  if (choices.excluded.includes(key)) return { ...choices, excluded: choices.excluded.filter((k) => k !== key) };
  const locked = { ...choices.locked };
  if (locked[courseCode] === groupId) delete locked[courseCode];
  return { ...choices, locked, excluded: [...choices.excluded, key] };
}

/** The courses to hand to `solve`: the pasted ones whose box is ticked, in paste order. */
export function includedCourses<T extends { code: string }>(courses: readonly T[], choices: CourseChoices): T[] {
  return courses.filter((course) => isIncluded(choices, course.code));
}

/**
 * The `locked` / `excluded` part of the payload, limited to what exists in the
 * pasted data and is included. Saved choices can outlive the paste they were
 * made on: a lock on a group that is no longer there would make every solve
 * `infeasible` (`locked-missing`), so stale entries are left out here.
 */
export function groupChoicesFor(courses: readonly IndexedCourse[], choices: CourseChoices): GroupChoices {
  const locked: Record<string, string> = {};
  const excluded: GroupKey[] = [];
  for (const course of includedCourses(courses, choices)) {
    const ids = new Set(course.groups.map((g) => g.group.id));
    const lockedId = choices.locked[course.code];
    if (typeof lockedId === "string" && ids.has(lockedId)) locked[course.code] = lockedId;
    for (const id of ids) {
      const key = groupKey(course.code, id);
      if (choices.excluded.includes(key) && locked[course.code] !== id) excluded.push(key);
    }
  }
  return { locked, excluded };
}

/** For the credit counter: the sum over included courses, and how many of them show "? TC". */
export function creditTotals(
  courses: readonly { code: string; credits: number | null }[],
  choices: CourseChoices,
): { credits: number; unknown: number } {
  let credits = 0;
  let unknown = 0;
  for (const course of includedCourses(courses, choices)) {
    if (typeof course.credits === "number" && Number.isFinite(course.credits)) credits += course.credits;
    else unknown++;
  }
  return { credits, unknown };
}

/** One button of the program selector on step 3. */
export interface ProgramOption {
  code: string;
  /** False for a prefix outside L / A / CC / TN: shown as "Khác (XYZ)". */
  known: boolean;
  /** False when no group of the given courses belongs to it: dimmed, still selectable (B2). */
  present: boolean;
}

/** The four known codes, always, then every other prefix found in the data (B2). */
export function programOptions(courses: readonly IndexedCourse[]): ProgramOption[] {
  const found = new Set<string>();
  for (const course of courses) for (const g of course.groups) found.add(programOf(g.group));
  const known: readonly string[] = PROGRAM_CODES;
  const others = [...found].filter((code) => code !== "" && !known.includes(code)).sort();
  return [
    ...known.map((code) => ({ code, known: true, present: found.has(code) })),
    ...others.map((code) => ({ code, known: false, present: true })),
  ];
}

// ---------------------------------------------------------------------------
// What is handed to `solve`
// ---------------------------------------------------------------------------

/**
 * Keeps out-of-program groups away from the solver (docs/ui-change-analysis.md A4, generalised).
 *
 * When a required item cannot be met, `solve` relaxes EVERY required item at
 * once, the program included, and then returns only its top K. Those K can all
 * use a group of another program even when a schedule inside the program
 * exists (real case: CO2001 + CO2007, program L, "Còn chỗ trống" required: all
 * ten options took a non-L group of CO2001, although its full L group gives an
 * in-program schedule). A student can never register such a schedule, so the
 * groups are removed BEFORE solving: a relaxed run can then only break the
 * student's other required items, and "no schedule" is only reported when no
 * in-program schedule exists.
 *
 * A course is left untouched when none of its in-program groups survives the
 * student's own lock / exclude choices (or it has none at all). `solve` then
 * answers `course-no-program` for it, and the results screen offers to drop the
 * course, exactly as before.
 */
export function restrictToProgram(courses: readonly IndexedCourse[], program: string, choices: GroupChoices): IndexedCourse[] {
  const excluded = new Set<string>(choices.excluded);
  return courses.map((course) => {
    const own = course.groups.filter((g) => programOf(g.group) === program);
    const lockedId = choices.locked[course.code];
    const usable = own.some((g) => !excluded.has(g.key) && (lockedId === undefined || lockedId === g.group.id));
    return usable ? { ...course, groups: own } : course;
  });
}

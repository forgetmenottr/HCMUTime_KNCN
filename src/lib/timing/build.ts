import type { Course, Group, Session } from "../parser";
import { MAX_WEEK, PERIODS, type TimeMask } from "./constants";
import { emptyMask, intersects, orInto, setSlot } from "./mask";

/** Every `TimeWarning.code` buildMasks() can emit. */
export const TIME_WARNING_CODES = [
  "duplicate-course",
  "duplicate-group",
  "slots-out-of-range",
  "internal-overlap",
  "group-no-sessions",
] as const;
export type TimeWarningCode = (typeof TIME_WARNING_CODES)[number];

/** A problem found while building masks. `groupId` is "" for course-level warnings. */
export interface TimeWarning {
  courseCode: string;
  groupId: string;
  /** English description (kept for compatibility; the UI translates `code`). */
  message: string;
  /** One of TIME_WARNING_CODES. */
  code: string;
  /** Values for the message template. */
  params: Record<string, unknown>;
}

export interface IndexedGroup {
  /** `${courseCode}:${groupId}`, unique across the result. */
  key: string;
  courseCode: string;
  /** The original Phase 1 object, unchanged. */
  group: Group;
  /** Union of all its sessions. */
  mask: TimeMask;
}

export interface IndexedCourse {
  code: string;
  name: string;
  credits: number | null;
  groups: IndexedGroup[];
}

/** Sets every (week, period) slot of a session; counts the slots that were out of range. */
export function buildSessionMask(s: Session): { mask: TimeMask; outOfRange: number } {
  const mask = emptyMask();
  let outOfRange = 0;
  for (const week of s.weeks) {
    for (const period of s.periods) {
      if (!setSlot(mask, week, s.day, period)) outOfRange++;
    }
  }
  return { mask, outOfRange };
}

/**
 * Builds one mask per group. Never mutates `courses`.
 * When a course code (or a group id within a course) appears twice, the later
 * occurrence wins: it replaces the earlier one in place, with a warning.
 */
export function buildMasks(courses: Course[]): { courses: IndexedCourse[]; warnings: TimeWarning[] } {
  const warnings: TimeWarning[] = [];
  const unique = latestByKey(courses, (course) => course.code, (course) =>
    warnings.push({
      courseCode: course.code,
      groupId: "",
      message: "course appears more than once; the later copy replaces the earlier one",
      code: "duplicate-course",
      params: {},
    }),
  );
  return { courses: unique.map((course) => indexCourse(course, warnings)), warnings };
}


/** Indexes the groups of one course; a repeated group id replaces the earlier one. */
function indexCourse(course: Course, warnings: TimeWarning[]): IndexedCourse {
  const unique = latestByKey(course.groups, (group) => group.id, (group) =>
    warnings.push({
      courseCode: course.code,
      groupId: group.id,
      message: "group appears more than once; the later copy replaces the earlier one",
      code: "duplicate-group",
      params: {},
    }),
  );
  const groups = unique.map((group) => indexGroup(course.code, group, warnings));
  return { code: course.code, name: course.name, credits: course.credits, groups };
}

/** One item per key; a later item replaces an earlier one at the earlier position. */
function latestByKey<T>(items: T[], keyOf: (item: T) => string, onDuplicate: (item: T) => void): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (byKey.has(key)) onDuplicate(item);
    byKey.set(key, item); // Map keeps the first insertion position
  }
  return [...byKey.values()];
}


/**
 * Unions the session masks of a group, warning on out-of-range slots, internal
 * overlaps and a group with no session at all (it would take no time, so it
 * fits into any schedule; usually a session line the parser had to skip).
 */
function indexGroup(courseCode: string, group: Group, warnings: TimeWarning[]): IndexedGroup {
  const warn = (code: TimeWarningCode, message: string, params: Record<string, unknown>) =>
    warnings.push({ courseCode, groupId: group.id, message, code, params });
  const mask = emptyMask();
  const sessionMasks: TimeMask[] = [];
  if (group.sessions.length === 0) warn("group-no-sessions", "group has no sessions", {});

  group.sessions.forEach((session, index) => {
    const built = buildSessionMask(session);
    if (built.outOfRange > 0) {
      warn(
        "slots-out-of-range",
        `session ${describe(session)}: ${built.outOfRange} slot(s) outside weeks 1-${MAX_WEEK} / periods 1-${PERIODS} skipped`,
        {
          session: index + 1,
          count: built.outOfRange,
          day: session.day,
          maxWeek: MAX_WEEK,
          periods: PERIODS,
          // The session itself, as in `describe()`; `periods` above is already the period limit.
          sessionPeriods: [...session.periods],
          room: session.room,
        },
      );
    }
    sessionMasks.forEach((earlier, earlierIndex) => {
      if (intersects(earlier, built.mask)) {
        warn("internal-overlap", `internal overlap: session ${index + 1} overlaps session ${earlierIndex + 1} (${describe(session)})`, {
          session: index + 1,
          other: earlierIndex + 1,
          day: session.day,
          sessionPeriods: [...session.periods],
          room: session.room,
        });
      }
    });
    sessionMasks.push(built.mask);
    orInto(mask, built.mask);
  });

  return { key: `${courseCode}:${group.id}`, courseCode, group, mask };
}

/** Short human-readable label, e.g. "day 2, periods 2,3,4, room A4-409". */
function describe(s: Session): string {
  return `day ${s.day}, periods ${s.periods.join(",")}, room ${s.room}`;
}

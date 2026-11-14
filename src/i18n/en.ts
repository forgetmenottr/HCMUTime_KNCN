import type { Day, ParseWarningCode } from "../lib/parser";
import type { ConstraintName, SolverDiagnosticCode } from "../lib/solver";
import type { TimeWarningCode } from "../lib/timing";
import { blank, clip, groupId, groupKey, ownRequired } from "./helpers";
import type { Dictionary, Fmt, HalfDay, Message, NameKey, Params } from "./types";
import type { UiKey } from "./vi";

/**
 * Labels for constraint names; each is the English name of the control on the
 * screen (see vi.ts). The "ui" table below reads these same strings for the
 * control labels, so a violation chip and its control can never differ.
 */
const constraint = {
  programs: "Study program",
  partsOff: "Days and half-days off",
  daysOff: "Days and half-days off",
  freeSeats: "Seats left",
  // No control on the screen; never sent "on" (see vi.ts).
  campuses: "Campus",
  language: "Teaching language",
  avoidLecturers: "Lecturers to avoid",
} satisfies Record<ConstraintName, string>;

const dayLong = {
  2: "Monday",
  3: "Tuesday",
  4: "Wednesday",
  5: "Thursday",
  6: "Friday",
  7: "Saturday",
  8: "Sunday",
} satisfies Record<Day, string>;

const dayShort = {
  2: "Mon",
  3: "Tue",
  4: "Wed",
  5: "Thu",
  6: "Fri",
  7: "Sat",
  8: "Sun",
} satisfies Record<Day, string>;

/** Rows of the days-off grid: a half-day the student wants off. */
const partOff = {
  morning: "Morning",
  afternoon: "Afternoon",
} satisfies Record<HalfDay, string>;

/** Choices of the time-of-day preference: when the student would rather study. Plural on purpose ("I prefer mornings"). */
const partStudy = {
  morning: "Mornings",
  afternoon: "Afternoons",
} satisfies Record<HalfDay, string>;

const campus = {
  1: "Campus 1 – Lý Thường Kiệt",
  2: "Campus 2 – Dĩ An",
} satisfies Record<1 | 2, string>;

const kind = {
  theory: "Theory",
  lab: "Lab",
} satisfies Record<"theory" | "lab", string>;

// ---------------------------------------------------------------------------
// Names that more than one sentence quotes. Each is written once, here; the
// strings below and the messages read them from these constants (or, for the
// three shared control names, through `fmt.name`).
// ---------------------------------------------------------------------------

/** The mode selector's labels (prefs.mode.*). A message that mentions a mode writes it exactly like this, capitalised. */
const MODE = { off: "Off", preferred: "Preferred", required: "Required" } as const;

/** The step that holds the course list; named by the no-courses message. */
const STEP_COURSES = "Courses and groups";

/** The two end labels shared by all three sliders of the schedule block (as in vi.ts). */
const SLIDER = { low: "Not important", high: "Important" } as const;

/** The checkbox on each course card; named by several solver messages. */
const INCLUDE_COURSE = "Include this course";

/** The page the data is copied from. Named by the messages that send the student back to check the paste. */
const REGISTRATION_PAGE = "the course registration page";
const RECHECK = `Please check the data against ${REGISTRATION_PAGE}.`;

/** Control names that other sentences quote (see NAME_KEYS), as in vi.ts. */
const name = {
  lock: "Take only this group",
  exclude: "Don’t take this group",
  preferredSwitch: `Count “${MODE.preferred}” items`,
} satisfies Record<NameKey, string>;

// ---------------------------------------------------------------------------
// English needs agreement where Vietnamese does not. Counts come from the
// params themselves and go through Intl.PluralRules (fmt.plural).
// ---------------------------------------------------------------------------

/** How many distinct items a list param holds; undefined when it is missing. A lone value counts as one. */
function countOf(value: unknown): number | undefined {
  if (Array.isArray(value)) return new Set(value).size;
  return value === undefined || value === null ? undefined : 1;
}

/** A noun that agrees with the list it introduces: "Period 5", "Periods 2–4", "week 3", "weeks 1–7, 9". */
function runsOf(f: Fmt, value: unknown, one: string, other: string): string {
  const runs = f.runs(value);
  return f.plural(countOf(value), { one: `${one} ${runs}`, other: `${other} ${runs}` });
}

/** A list of constraint names, each quoted: a label can itself contain "and" ("Days and half-days off"), which would blur a plain list. */
function quoted(f: Fmt, names: unknown): string {
  return f.list(names, (item) => `“${f.constraint(item)}”`);
}

/** "Monday, periods 2–4, room A4-409": one session, as the student sees it on screen 2. */
function session(p: Params, f: Fmt): string {
  return `${f.day(p.day)}, ${runsOf(f, p.sessionPeriods, "period", "periods")}, room ${f.str(p.room)}`;
}

/** course-no-program, first sentence; the result screen shows the same words (results.noProgram). */
function noProgram(course: unknown, program: unknown, f: Fmt): string {
  const programs = Array.isArray(program) ? f.list(program) : f.str(program);
  return f.plural(countOf(program), {
    one: `Course ${f.str(course)} has no group left in program ${programs}.`,
    other: `Course ${f.str(course)} has no group left in programs ${programs}.`,
  });
}

/** course-no-program, second sentence (results.noProgramWhy). */
function noProgramWhy(available: unknown, f: Fmt): string {
  const programs = Array.isArray(available) ? f.list(available) : f.str(available);
  return f.plural(countOf(available), {
    one: `This course only has groups in program ${programs}.`,
    other: `This course only has groups in programs ${programs}.`,
  });
}

/** Parse warnings, about the pasted data: what is wrong, what happened to it, what to do. The UI puts "Line {line}" in front (paste.line). */
const parse = {
  "internal-error": (p, f) =>
    `The app hit an error while reading this line, so the line may not have been read correctly. This is a bug in the app, not a problem with the data you pasted. (Details: ${clip(f.str(p.error))})`,
  "unrecognized-line":
    "This line could not be read, so it was skipped. If it is not part of the course table, you do not need to do anything.",
  "group-before-course":
    "This group comes before any course name, so it was skipped. Copy the course name line (like “CO2007 - Course name”) from above the group table.",
  "invalid-group-id": (p, f) =>
    `The group id “${clip(f.str(p.id), 40)}” is not in the right form (for example A01 or A01_A01), so the whole group was skipped.`,
  "missing-registered-capacity":
    "This group has no registered / capacity figure (like 34/40), so the whole group was skipped. Copy this course again.",
  "missing-language": "This group has no teaching language (V or TA). The group is still used to build schedules.",
  "session-without-group":
    "This session does not belong to any group that could be read, so it was skipped. This is usually caused by an error in the group line above it: fix that line first.",
  // A skipped session leaves its group with one session fewer, so the group can be
  // picked into a schedule that clashes in reality. Each message says so.
  "session-no-day":
    "This session has no day, so it was skipped and the group will be missing this session when schedules are built. Copy this course again.",
  "session-no-room":
    "This session has no room (like C5-202), so it was skipped and the group will be missing this session when schedules are built. Copy this course again.",
  "session-no-weeks":
    "This session has no week pattern, so it was skipped and the group will be missing this session when schedules are built. Copy this course again.",
  "session-no-periods":
    "This session has no periods, so it was skipped and the group will be missing this session when schedules are built. Copy this course again.",
  "period-column-count": (p, f) =>
    f.plural(p.found, {
      one: `The periods section has # column instead of ${f.num(p.expected)}. The periods are still read from the numbers written on the line. ${RECHECK}`,
      other: `The periods section has # columns instead of ${f.num(p.expected)}. The periods are still read from the numbers written on the line. ${RECHECK}`,
    }),
  "period-misplaced": `A period number is not in its own column. The periods are still read from the numbers written on the line. ${RECHECK}`,
  "week-digit-mismatch": (p, f) =>
    f.plural(countOf(p.weeks), {
      one: `The week pattern has a digit that does not match week ${f.runs(p.weeks)}; the weeks were read by position. ${RECHECK}`,
      other: `The week pattern has digits that do not match weeks ${f.runs(p.weeks)}; the weeks were read by position. ${RECHECK}`,
    }),
  "unknown-campus": (p, f) =>
    blank(p.campus)
      ? "This session has no campus (1 or 2). The session is still used to build schedules."
      : `Campus “${clip(f.str(p.campus), 40)}” is not 1 or 2. The session is still used to build schedules.`,
  "no-teaching-week": `The week pattern has no weeks in it, so this session is not counted when schedules are built. ${RECHECK}`,
  "no-courses-found": "No courses were found in the pasted content.",
} satisfies Record<ParseWarningCode, Message>;

/**
 * Timing warnings, about the pasted data, shown on the course or group row of
 * screen 2. `slots-out-of-range.count` counts week × period cells, which mean
 * nothing to a student, so it is not shown. The reason for the cut is worded so
 * that it is true whether one period (or week) is out or several ("includes ...").
 */
const timing = {
  "duplicate-course": "Course {courseCode} was pasted more than once; the app uses the last copy.",
  "duplicate-group": "Group {groupId} of course {courseCode} appears more than once; the app uses the last copy.",
  "slots-out-of-range": (p, f) => {
    const limit = typeof p.periods === "number" ? p.periods : 16;
    const periods = Array.isArray(p.sessionPeriods) ? p.sessionPeriods : [];
    const periodOut = periods.some((n) => typeof n !== "number" || n < 1 || n > limit);
    return periodOut
      ? `The session (${session(p, f)}) includes periods outside 1–${f.num(p.periods)}; those periods are not counted when schedules are built. ${RECHECK}`
      : `The session (${session(p, f)}) includes weeks after week ${f.num(p.maxWeek)}; those weeks are not counted when schedules are built. ${RECHECK}`;
  },
  // `session` / `other` are positions in the pasted list; "session 2" could be misread as a day, so they are not shown.
  "internal-overlap": (p, f) =>
    `The session (${session(p, f)}) overlaps another session of the same group, ${f.str(p.groupId)}. The schedule is still built, but please check the data against ${REGISTRATION_PAGE}.`,
  "group-no-sessions":
    "Group {groupId} of course {courseCode} has no sessions that could be read, so schedules built with it may not be accurate. Copy this course again.",
} satisfies Record<TimeWarningCode, Message>;

/**
 * Solver diagnostics, shown in the result banner: what blocked the schedule
 * and which choice to loosen. Constraint names go through `quoted` (each one a
 * label of a control on screen), lock / exclude through `fmt.name`, and mode
 * names through MODE, written as on the mode selector. `relaxed.weight` and
 * `truncated.maxNodes` are never shown.
 */
const solver = {
  "no-courses": `You haven’t chosen any course to schedule. Choose at least one course in the “${STEP_COURSES}” step.`,
  // Internal guard (isConflictFree): a bug, not something the student did.
  "dropped-conflicting": (p, f) =>
    f.plural(p.count, {
      one: "# schedule was dropped because a final check found a time clash. This is a bug in the app; the schedules shown still have no time clashes.",
      other: "# schedules were dropped because a final check found a time clash. This is a bug in the app; the schedules shown still have no time clashes.",
    }),
  // `constraints` never contains "programs" here: that one has its own code, course-no-program.
  "course-blocked": (p, f) =>
    `No group of course ${f.str(p.course)} meets ${quoted(f, p.constraints)} (set to ${MODE.required}). Relax your choices, or switch to ${MODE.preferred}.`,
  // Each constraint alone leaves a group, so at least two are listed, and at least one is the student's own.
  "course-blocked-combined": (p, f) =>
    ownRequired(p.constraints).length === 0
      ? `No group of course ${f.str(p.course)} meets ${quoted(f, p.constraints)} at the same time.`
      : `No group of course ${f.str(p.course)} meets ${quoted(f, p.constraints)} at the same time. Switch ${quoted(f, ownRequired(p.constraints))} to ${MODE.preferred}.`,
  "no-combination-required": (p, f) =>
    ownRequired(p.constraints).length === 0
      ? "The groups in your study program cannot be combined into any schedule without time clashes. Try dropping a course."
      : `No combination of groups is free of time clashes and meets ${quoted(f, p.constraints)}. Switch ${quoted(f, ownRequired(p.constraints))} to ${MODE.preferred}, or drop a course.`,
  // Same words as results.noProgram + results.noProgramWhy, which the result screen shows for this code (A4).
  "course-no-program": (p, f) => `${noProgram(p.course, p.allowed, f)} ${noProgramWhy(p.available, f)}`,
  relaxed: (p, f) =>
    f.plural(countOf(p.constraints), {
      one: `No schedule meets ${quoted(f, p.constraints)}, so the options below may break it. Where it is broken is marked on each option.`,
      other: `No schedule meets all of ${quoted(f, p.constraints)}, so the options below may break them. Where they are broken is marked on each option.`,
    }),
  "course-no-groups": `Course {course} has no groups that could be read from the pasted data. Paste this course again, or uncheck “${INCLUDE_COURSE}”.`,
  "all-excluded": (p, f) =>
    f.plural(p.count, {
      one: `Course ${f.str(p.course)} has only one group, and you chose “${f.name("exclude")}” for it. Remove that choice, or uncheck “${INCLUDE_COURSE}”.`,
      other: `You chose “${f.name("exclude")}” for all # groups of course ${f.str(p.course)}. Remove this choice from at least one group, or uncheck “${INCLUDE_COURSE}”.`,
    }),
  "locked-excluded": (p, f) =>
    `Group ${groupId(p.key, f)} of course ${f.str(p.course)} has both “${f.name("lock")}” and “${f.name("exclude")}” chosen. Remove one of the two.`,
  "locked-missing": (p, f) =>
    `You chose “${f.name("lock")}” for group ${groupId(p.key, f)} of course ${f.str(p.course)}, but the pasted data has no such group. Choose a group for this course again.`,
  // Every group clashes with *some* locked group, not necessarily with each one.
  "conflicts-with-locked": (p, f) => {
    const locked = f.list(p.locked, (key) => groupKey(key, f));
    return f.plural(countOf(p.locked), {
      one: `Every group of course ${f.str(p.course)} clashes in time with the group you chose “${f.name("lock")}” for: ${locked}. Remove that choice, or uncheck “${INCLUDE_COURSE}” for course ${f.str(p.course)}.`,
      other: `Every group of course ${f.str(p.course)} clashes in time with at least one of the groups you chose “${f.name("lock")}” for: ${locked}. Remove one of those choices, or uncheck “${INCLUDE_COURSE}” for course ${f.str(p.course)}.`,
    });
  },
  // afterRelax is required.length > 0; the UI always sends programs as required, so it is true in practice.
  "no-combination": (p, f) =>
    p.afterRelax === true
      ? `No combination of groups is free of time clashes, even if the ${MODE.required} items are allowed to be broken. Drop a course, or remove some “${f.name("lock")}” and “${f.name("exclude")}” choices if you have any.`
      : `No combination of groups is free of time clashes. Drop a course, or remove some “${f.name("lock")}” and “${f.name("exclude")}” choices if you have any.`,
  // Only emitted when nothing was found. Locking a group shrinks the search, so it is real advice.
  truncated: (_, f) =>
    `The search stopped early before it found any schedule, so a valid schedule may still exist. Drop a course, or choose “${f.name("lock")}” in a few courses to narrow the search.`,
  // Rebuilt from params.overlap: "Monday, periods 2–3 (weeks 1–7, 9–16); Sunday, periods 8–10 (weeks 6, 10, 12, 14)".
  // Items are joined with "; " because each one already contains commas.
  "locked-overlap": (p, f) => {
    const items = Array.isArray(p.overlap) ? p.overlap : [];
    const when =
      items.length === 0
        ? f.str(undefined)
        : items
            .map((item: { day?: unknown; periods?: unknown; weeks?: unknown }) =>
              `${f.day(item?.day)}, ${runsOf(f, item?.periods, "period", "periods")} (${runsOf(f, item?.weeks, "week", "weeks")})`)
            .join("; ");
    return `The two groups you chose “${f.name("lock")}” for clash in time: ${groupKey(p.a, f)} and ${groupKey(p.b, f)}, on ${when}. Remove the choice from one of the two groups.`;
  },
} satisfies Record<SolverDiagnosticCode, Message>;

/** "Total: 9 credit(s)", shared by the two total-credit strings. */
const TOTAL_CREDITS = { one: "Total: # credit", other: "Total: # credits" };

/**
 * Static UI strings. `satisfies Record<UiKey, …>` ties the key list to the
 * Vietnamese one: a missing or extra key is a compile error. The control labels
 * of the three constraint controls read `constraint` above.
 */
const ui = {
  // --- Common ------------------------------------------------------------------
  "step.paste": "Paste data",
  "step.courses": STEP_COURSES,
  "step.prefs": "Preferences", // same word as "You haven’t set any preferences yet" (B6)
  "step.results": "Results",
  "nav.back": "Back",
  "nav.next": "Continue",
  "lang.switch": "Language", // ARIA label; the two choices "Tiếng Việt" / "English" are never translated

  // --- Screen 1: Paste data ------------------------------------------------------
  "paste.placeholder": `Paste the data from ${REGISTRATION_PAGE} here`,
  // TẠM (PLACEHOLDER): left untranslated on purpose. The owner is still writing the real
  // sentence (see vi.ts); write its English together with the Vietnamese, not before.
  "paste.hint": "Sao chép thông tin môn cùng bảng nhóm lớp trên trang Đăng ký môn học. Dán được nhiều môn cùng lúc.",
  "paste.parse": "Read data",
  "paste.warningsTitle": "Some lines need a second look",
  "paste.line": "Line {line}", // not used for line 0 (no-courses-found is a warning about the whole input)

  // --- Screen 2: Courses and groups ----------------------------------------------
  "courses.credits": (p, f) => f.plural(p.n, { one: "# credit", other: "# credits" }),
  "courses.creditsUnknown": "? credits",
  "courses.totalCredits": (p, f) => f.plural(p.n, TOTAL_CREDITS),
  "courses.totalCreditsPartial": (p, f) =>
    `${f.plural(p.n, TOTAL_CREDITS)} (${f.plural(p.m, { one: "not counting # course", other: "not counting # courses" })})`,
  "courses.colGroup": "Group",
  "courses.colSeats": "Registered / Capacity",
  "courses.colProgram": "Program",
  "courses.full": "Full",
  "courses.periods": (p, f) => runsOf(f, p.periods, "Period", "Periods"),
  "courses.weeks": (p, f) => runsOf(f, p.weeks, "Week", "Weeks"),
  "courses.labTip": "Meets every other week, so it is probably a lab session.",
  "courses.lock": (_, f) => f.name("lock"), // the text lives in `name`
  "courses.exclude": (_, f) => f.name("exclude"), // the text lives in `name`
  "courses.include": INCLUDE_COURSE,
  "courses.warningTitle": "Class times need a second look",

  // --- Screen 3: Preferences -----------------------------------------------------
  "prefs.block.program": constraint.programs, // the block title is the control's name
  "prefs.block.groups": "Which groups can be chosen",
  "prefs.block.schedule": "What should your schedule look like?",

  "prefs.mode.off": MODE.off,
  "prefs.mode.preferred": MODE.preferred,
  "prefs.mode.required": MODE.required,
  "prefs.mode.requiredTip":
    "Rules out every group that breaks it. If that leaves no schedule, the app relaxes it and tells you.",
  "prefs.mode.preferredTip": (_, f) =>
    `A group that breaks it can still be chosen, but that schedule is ranked lower. This only works while the ${f.name("preferredSwitch")} switch is on.`,

  "prefs.program.other": "Other ({prefix})",
  "prefs.program.absentTip": "None of the courses you pasted have a group in this program",
  "prefs.program.required": "Choose your study program",

  "prefs.preferredSwitch.label": (_, f) => f.name("preferredSwitch"), // the text lives in `name`
  "prefs.preferredSwitch.hint": `When on, a schedule that breaks an item set to ${MODE.preferred} is ranked lower but can still be chosen.`,
  "prefs.preferredSwitch.disabledTip": (_, f) =>
    `The ${f.name("preferredSwitch")} switch is off, so items set to ${MODE.preferred} have no effect. Turn it back on to use them.`,
  "prefs.preferredSwitch.paused": `Temporarily off (was: ${MODE.preferred})`,

  "prefs.partsOff.label": constraint.partsOff, // same string as the constraint label
  "prefs.partsOff.tip": "Days and half-days you want to have off. A group with a period in a selected cell counts as a violation.",
  "prefs.partsOff.wholeDay": "Whole day",
  "prefs.periodRange": "periods {from}–{to}", // "Morning (periods 1–6)"; a range, so always plural

  "prefs.freeSeats.label": constraint.freeSeats, // same string as the constraint label
  "prefs.freeSeats.tip": "Choose only groups that still have seats. A full group counts as a violation.",

  // Avoids "Preferred" here: that word is the mode name (see docs/i18n-plan.md 2.7).
  "prefs.timeOfDay.label": "When would you rather study?",
  "prefs.timeOfDay.none": "None",
  "prefs.timeOfDay.low": SLIDER.low,
  "prefs.timeOfDay.high": SLIDER.high,
  "prefs.timeOfDay.tip":
    "The more periods a schedule has outside the half-day you choose, the lower it is ranked. Periods 13–16 always count as outside.",
  "prefs.fewerDays.label": "Fewer days at school each week",
  "prefs.fewerDays.low": SLIDER.low,
  "prefs.fewerDays.high": SLIDER.high,
  "prefs.fewerDays.tip": "The more days a week a schedule has you at school, the lower it is ranked.",
  "prefs.avoidEarly.label": "Avoid periods 1–2",
  "prefs.avoidEarly.low": SLIDER.low,
  "prefs.avoidEarly.high": SLIDER.high,
  "prefs.avoidEarly.tip": "The more periods 1–2 a schedule has, the lower it is ranked.",

  "prefs.share.label": "Share",
  "prefs.share.value": "makes up {p}%",
  "prefs.share.aria": "level {v} out of 10, makes up {p}%",
  "prefs.noWishes":
    "You haven’t set any preferences yet. Valid schedules will be listed in the order they were found, not by how well they fit.",

  // The noun agrees with the number, so the UI passes the stepper's current value as `n` and splits the sentence at that number.
  "prefs.topK": (p, f) => f.plural(p.n, { one: "Show # option", other: "Show # options" }),
  "prefs.solve": "Build schedule",

  // --- Screen 4: Results ---------------------------------------------------------
  "results.relaxedTitle": `No schedule meets all the ${MODE.required} items`,
  "results.infeasibleTitle": "No schedule could be built",
  "results.noProgram": (p, f) => noProgram(p.course, p.program, f),
  "results.noProgramWhy": (p, f) => noProgramWhy(p.available, f),
  "results.dropCourse": "Drop this course and build again",
  "results.option": "Option {n}",
  "results.tie": "Equally good",
  "results.violation": (p, f) => `${f.constraint(p.item)}: ${f.list(p.courses)}`, // "Days and half-days off: CO2007"
  "results.periodRow": "Period {n}",
  "results.alternating": "Alternating weeks",
  "results.registerList": "Groups to register for",
  // The alternatives are "either one", so they are joined with commas, as in Vietnamese, not with "and".
  "results.alternatives": (p, f) =>
    `Also works: ${Array.isArray(p.list) && p.list.length > 0 ? p.list.map(f.str).join(", ") : f.str(undefined)}`,
  "results.truncated": "The search stopped early; better options may exist",
  "results.stats": (p, f) =>
    typeof p.ms === "number" && p.ms < 1000
      ? "Searched in under 1 second"
      : f.plural(typeof p.ms === "number" ? Math.round(p.ms / 100) / 10 : undefined, {
          one: "Searched in # second",
          other: "Searched in # seconds",
        }),
  "results.empty": "You haven’t chosen any course to schedule.",
  "results.solving": "Building schedule…",
} satisfies Record<UiKey, Message>;

/** English (second language). Every section is complete; see status.ts. */
export const en: Dictionary = {
  parse,
  timing,
  solver,
  constraint,
  dayLong,
  dayShort,
  partOff,
  partStudy,
  campus,
  kind,
  name,
  ui,
};

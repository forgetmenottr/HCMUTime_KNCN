import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/lib/parser";
import type { Course, Session } from "../src/lib/parser";
import {
  buildMasks as buildMasksRaw,
  buildSessionMask,
  conflictSlots,
  conflictSummary,
  conflicts,
  emptyMask,
  hasSlot,
  intersects,
  MASK_WORDS,
  orInto,
  popcount,
  setSlot,
  slots,
  TIME_WARNING_CODES,
  TOTAL_BITS,
  type IndexedGroup,
  type TimeWarning,
} from "../src/lib/timing";

/** Every warning the tests below produce; the last test checks that each has a code. */
const emitted: TimeWarning[] = [];
function buildMasks(courses: Course[]) {
  const result = buildMasksRaw(courses);
  emitted.push(...result.warnings);
  return result;
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Parses a real fixture copied from the registration page. */
function parseFixture(name: string): Course[] {
  const result = parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  expect(result.warnings).toEqual([]);
  return result.courses;
}

const COURSES = [...parseFixture("CO2007.txt"), ...parseFixture("CO2011.txt")];
const BUILT = buildMasks(COURSES);
const GROUPS = BUILT.courses.flatMap((c) => c.groups);
const SESSIONS = COURSES.flatMap((c) => c.groups.flatMap((g) => g.sessions));

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const THEORY_WEEKS = [...range(1, 7), ...range(9, 16)];
const DAYS = range(2, 8);
const PERIODS = range(1, 16);

function byKey(key: string): IndexedGroup {
  const group = GROUPS.find((g) => g.key === key);
  if (!group) throw new Error(`group ${key} not found`);
  return group;
}

/** The single session of the given kind in a group. */
function sessionOf(key: string, kind: Session["kind"]): Session {
  const found = byKey(key).group.sessions.filter((s) => s.kind === kind);
  expect(found, `${key} ${kind} sessions`).toHaveLength(1);
  return found[0];
}

function maskOf(key: string, kind: Session["kind"]) {
  return buildSessionMask(sessionOf(key, kind)).mask;
}

/** A copy of the fixture courses that can be edited without touching COURSES. */
function editableCourses(): Course[] {
  return structuredClone(COURSES);
}

function findGroup(courses: Course[], courseCode: string, groupId: string) {
  const group = courses.find((c) => c.code === courseCode)?.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`${courseCode}:${groupId} not found`);
  return group;
}

// ---------------------------------------------------------------------------
// Low-level mask operations
// ---------------------------------------------------------------------------

describe("mask layout and operations", () => {
  it("has 3360 bits in 105 words", () => {
    expect(TOTAL_BITS).toBe(3360);
    expect(MASK_WORDS).toBe(105);
    expect(emptyMask()).toHaveLength(105);
  });

  it("places slots at ((week-1)*7 + (day-2))*16 + (period-1)", () => {
    const cases: [week: number, day: number, period: number, word: number, bit: number][] = [
      [1, 2, 1, 0, 0], // first bit
      [1, 3, 1, 0, 16], // next day
      [2, 2, 1, 3, 16], // next week: bit 112
      [30, 8, 16, 104, 31], // last bit: 3359
    ];
    for (const [week, day, period, word, bit] of cases) {
      const mask = emptyMask();
      expect(setSlot(mask, week, day, period)).toBe(true);
      expect(mask[word]).toBe((1 << bit) >>> 0);
      expect(popcount(mask)).toBe(1);
      expect(slots(mask)).toEqual([{ week, day, period }]);
    }
  });

  it("rejects out-of-range slots without throwing", () => {
    const mask = emptyMask();
    const invalid = [
      [0, 2, 1], [31, 2, 1], [1, 1, 1], [1, 9, 1], [1, 2, 0], [1, 2, 17], [1.5, 2, 1], [Number.NaN, 2, 1],
    ];
    for (const [week, day, period] of invalid) {
      expect(setSlot(mask, week, day, period)).toBe(false);
      expect(hasSlot(mask, week, day, period)).toBe(false);
    }
    expect(popcount(mask)).toBe(0);
  });

  it("ORs, intersects and decodes slots in (week, day, period) order", () => {
    const a = emptyMask();
    const b = emptyMask();
    setSlot(a, 3, 5, 7);
    setSlot(b, 1, 8, 16);
    expect(intersects(a, b)).toBe(false);
    orInto(a, b);
    expect(popcount(a)).toBe(2);
    expect(intersects(a, b)).toBe(true);
    expect(slots(a)).toEqual([
      { week: 1, day: 8, period: 16 },
      { week: 3, day: 5, period: 7 },
    ]);
  });

  it("detects an overlap in any word, including the very first and last slot", () => {
    for (const [week, day, period] of [[1, 2, 1], [16, 8, 16], [30, 8, 16]]) {
      const a = emptyMask();
      const b = emptyMask();
      setSlot(a, week, day, period);
      setSlot(b, week, day, period);
      setSlot(b, week === 1 ? 2 : 1, day, period); // a non-shared slot elsewhere
      expect(intersects(a, b), `${week}/${day}/${period}`).toBe(true);
      expect(conflictSlots(a, b)).toEqual([{ week, day, period }]);
    }
  });
});

// ---------------------------------------------------------------------------
// Masks built from the fixtures
// ---------------------------------------------------------------------------

describe("buildMasks on the fixtures", () => {
  it("returns zero warnings", () => {
    expect(BUILT.warnings).toEqual([]);
  });

  it("indexes every group under a unique course:group key", () => {
    expect(BUILT.courses.map((c) => [c.code, c.groups.length])).toEqual([["CO2007", 18], ["CO2011", 10]]);
    expect(new Set(GROUPS.map((g) => g.key)).size).toBe(28);
    expect(byKey("CO2007:A01_A01").courseCode).toBe("CO2007");
    expect(BUILT.courses[1]).toMatchObject({ code: "CO2011", name: "Mô hình hóa toán học", credits: 3 });
  });

  it("keeps the original Phase 1 objects and does not mutate them", () => {
    const courses = editableCourses();
    const before = structuredClone(courses);
    const built = buildMasks(courses);
    expect(courses).toEqual(before);
    expect(built.courses[0].groups[0].group).toBe(courses[0].groups[0]);
  });

  it("builds CO2007:A01_A01 = 3 periods × 15 weeks + 5 periods × 4 weeks", () => {
    expect(popcount(byKey("CO2007:A01_A01").mask)).toBe(65);
  });

  it("maps Sunday (day 8) and leaves break week 8 empty in CO2007:CC04_CC07", () => {
    const { mask } = byKey("CO2007:CC04_CC07");
    expect(hasSlot(mask, 6, 8, 2)).toBe(true);
    for (const day of DAYS) {
      for (const period of PERIODS) expect(hasSlot(mask, 8, day, period)).toBe(false);
    }
  });

  it("builds CO2011:A01 = 2 periods × 15 weeks", () => {
    expect(popcount(byKey("CO2011:A01").mask)).toBe(30);
  });

  it("decodes periods × weeks slots for every session", () => {
    for (const session of SESSIONS) {
      const { mask, outOfRange } = buildSessionMask(session);
      expect(outOfRange).toBe(0);
      expect(slots(mask)).toHaveLength(session.periods.length * session.weeks.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Conflicts between real groups
// ---------------------------------------------------------------------------

describe("conflicts on the fixtures", () => {
  it("1. alternating-week labs at the same time do NOT conflict", () => {
    const labA = sessionOf("CO2007:A01_A01", "lab");
    const labB = sessionOf("CO2007:CC01_CC01", "lab");
    // Premise: same day and periods, disjoint weeks.
    expect(labA).toMatchObject({ day: 2, periods: [8, 9, 10, 11, 12], weeks: [6, 10, 12, 14] });
    expect(labB).toMatchObject({ day: 2, periods: [8, 9, 10, 11, 12], weeks: [7, 9, 11, 13] });
    expect(intersects(buildSessionMask(labA).mask, buildSessionMask(labB).mask)).toBe(false);

    // Their theory sessions do not overlap either, so the whole groups are compatible.
    expect(intersects(maskOf("CO2007:A01_A01", "theory"), maskOf("CO2007:CC01_CC01", "theory"))).toBe(false);
    expect(conflicts(byKey("CO2007:A01_A01"), byKey("CO2007:CC01_CC01"))).toBe(false);
  });

  it("2. same-week labs at the same time conflict on 20 slots", () => {
    const labA = maskOf("CO2007:A01_A01", "lab");
    const labB = maskOf("CO2007:L02_L04", "lab");
    expect(sessionOf("CO2007:L02_L04", "lab")).toMatchObject({ day: 2, periods: [8, 9, 10, 11, 12], weeks: [6, 10, 12, 14] });
    expect(intersects(labA, labB)).toBe(true);
    expect(conflictSlots(labA, labB)).toHaveLength(20);
    expect(conflictSummary(labA, labB)).toEqual([{ day: 2, periods: [8, 9, 10, 11, 12], weeks: [6, 10, 12, 14] }]);
  });

  it("3. theory overlap across courses conflicts", () => {
    const a = byKey("CO2007:A01_A01");
    const b = byKey("CO2011:L01");
    expect(conflicts(a, b)).toBe(true);
    expect(conflictSummary(a, b)).toEqual([{ day: 2, periods: [2, 3], weeks: THEORY_WEEKS }]);
  });

  it("4. partial period overlap in lab weeks only", () => {
    const theory = maskOf("CO2007:CC04_CC07", "theory");
    const lab = maskOf("CO2007:A01_A01", "lab");
    expect(sessionOf("CO2007:CC04_CC07", "theory")).toMatchObject({ day: 2, periods: [7, 8, 9], weeks: THEORY_WEEKS });
    expect(conflictSlots(theory, lab)).toHaveLength(8);
    expect(conflictSummary(theory, lab)).toEqual([{ day: 2, periods: [8, 9], weeks: [6, 10, 12, 14] }]);
  });

  it("5. adjacent periods do NOT conflict", () => {
    expect(conflicts(byKey("CO2011:CC01"), byKey("CO2011:CC02"))).toBe(false);
    expect(conflictSummary(byKey("CO2011:CC01"), byKey("CO2011:CC02"))).toEqual([]);
  });

  it("6. overlap by one period conflicts", () => {
    const a = byKey("CO2011:A01");
    const b = byKey("CO2011:CC02");
    expect(conflicts(a, b)).toBe(true);
    expect(conflictSummary(a, b)).toEqual([{ day: 6, periods: [5], weeks: THEORY_WEEKS }]);
  });

  it("7. different days do NOT conflict", () => {
    expect(conflicts(byKey("CO2007:A01_A01"), byKey("CO2011:A01"))).toBe(false);
  });

  it("summarizes weeks with different overlapping periods as separate items", () => {
    // A partial timetable: CO2011:L01 (Mon 2-3, all weeks) + CC04_CC07's theory (Mon 7-9, all weeks).
    const partial = emptyMask();
    orInto(partial, byKey("CO2011:L01").mask);
    orInto(partial, maskOf("CO2007:CC04_CC07", "theory"));
    // A01_A01 hits periods 2-3 every week, plus 8-9 in its lab weeks.
    expect(conflictSummary(byKey("CO2007:A01_A01"), partial)).toEqual([
      { day: 2, periods: [2, 3], weeks: [1, 2, 3, 4, 5, 7, 9, 11, 13, 15, 16] },
      { day: 2, periods: [2, 3, 8, 9], weeks: [6, 10, 12, 14] },
    ]);
  });
});

describe("conflict properties", () => {
  it("is symmetric for every pair of groups", () => {
    for (const a of GROUPS) {
      for (const b of GROUPS) expect(conflicts(a, b), `${a.key} vs ${b.key}`).toBe(conflicts(b, a));
    }
  });

  it("makes every group conflict with itself", () => {
    for (const group of GROUPS) expect(conflicts(group, group), group.key).toBe(true);
  });

  it("makes an empty mask conflict with nothing", () => {
    const empty: IndexedGroup = { ...GROUPS[0], key: "empty", mask: emptyMask() };
    for (const group of GROUPS) {
      expect(conflicts(empty, group)).toBe(false);
      expect(conflicts(group, empty)).toBe(false);
    }
  });

  it("agrees with the core rule: same day AND shared period AND shared week", () => {
    const shares = (a: number[], b: number[]) => a.some((x) => b.includes(x));
    const sessionsClash = (s: Session, t: Session) =>
      s.day === t.day && shares(s.periods, t.periods) && shares(s.weeks, t.weeks);
    for (const a of GROUPS) {
      for (const b of GROUPS) {
        const expected = a.group.sessions.some((s) => b.group.sessions.some((t) => sessionsClash(s, t)));
        expect(conflicts(a, b), `${a.key} vs ${b.key}`).toBe(expected);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Robustness (fixtures edited minimally)
// ---------------------------------------------------------------------------

describe("robustness", () => {
  it.each([
    { name: "week 31", edit: (s: Session) => void s.weeks.push(31), skipped: 3 },
    { name: "period 17", edit: (s: Session) => void s.periods.push(17), skipped: 15 },
  ])("skips out-of-range slots with one warning per session ($name)", ({ edit, skipped }) => {
    const courses = editableCourses();
    // A01_A01 theory session: Mon periods 2-4, 15 weeks.
    const session = findGroup(courses, "CO2007", "A01_A01").sessions[0];
    edit(session);

    expect(buildSessionMask(session).outOfRange).toBe(skipped);
    let result: ReturnType<typeof buildMasks> | undefined;
    expect(() => (result = buildMasks(courses))).not.toThrow();
    expect(result!.warnings).toEqual([
      {
        courseCode: "CO2007",
        groupId: "A01_A01",
        message: expect.stringContaining("outside"),
        code: "slots-out-of-range",
        params: expect.objectContaining({ session: 1, count: skipped }),
      },
    ]);
    // The in-range slots are unchanged.
    expect(popcount(result!.courses[0].groups[0].mask)).toBe(65);
  });

  it("warns on an internal overlap and still builds the mask", () => {
    const courses = editableCourses();
    // L03_L05: lab Wed 2-6 (weeks 7,9,11,13) and theory Wed 10-12. Move the lab to 8-12.
    const group = findGroup(courses, "CO2007", "L03_L05");
    group.sessions[0].periods = [8, 9, 10, 11, 12];

    const result = buildMasks(courses);
    expect(result.warnings).toEqual([
      {
        courseCode: "CO2007",
        groupId: "L03_L05",
        message: expect.stringContaining("internal overlap"),
        code: "internal-overlap",
        params: { session: 2, other: 1, day: 4 },
      },
    ]);
    const mask = result.courses[0].groups.find((g) => g.group.id === "L03_L05")!.mask;
    expect(popcount(mask)).toBe(20 + 45 - 12); // lab + theory - shared (periods 10-12 × 4 weeks)
  });

  it("lets a re-pasted course replace the earlier copy in place", () => {
    const [co2007, co2011] = editableCourses();
    const [repasted] = editableCourses();
    repasted.groups[0].registered = 40; // e.g. A01_A01 filled up since the first paste

    const result = buildMasks([co2007, co2011, repasted]);
    expect(result.courses.map((c) => c.code)).toEqual(["CO2007", "CO2011"]);
    expect(result.courses[0].groups[0].group).toBe(repasted.groups[0]);
    expect(result.courses[0].groups[0].group.registered).toBe(40);
    expect(result.warnings).toEqual([
      { courseCode: "CO2007", groupId: "", message: expect.stringContaining("later copy replaces"), code: "duplicate-course", params: {} },
    ]);
    expect(new Set(result.courses.flatMap((c) => c.groups.map((g) => g.key))).size).toBe(28);
  });

  it("lets a repeated group id replace the earlier group in place", () => {
    const courses = editableCourses();
    const co2011 = courses[1];
    const later = structuredClone(co2011.groups[0]); // A01
    later.registered = 80;
    co2011.groups.push(later);

    const result = buildMasks(courses);
    const groups = result.courses[1].groups;
    expect(groups.map((g) => g.group.id)).toEqual(["A01", "CC01", "CC02", "CC03", "CC04", "CC05", "L01", "L02", "L03", "TN01"]);
    expect(groups[0].group).toBe(later);
    expect(result.warnings).toEqual([
      { courseCode: "CO2011", groupId: "A01", message: expect.stringContaining("later copy replaces"), code: "duplicate-group", params: {} },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Performance sanity check
// ---------------------------------------------------------------------------

describe("performance", () => {
  // A sanity check that conflicts() stays cheap, not a benchmark: the generous
  // threshold only catches order-of-magnitude regressions, so it should not flake on slow CI.
  it("checks all group pairs 10,000 times in under 3 seconds", () => {
    // Every unordered pair of distinct groups, as two parallel arrays.
    const left: IndexedGroup[] = [];
    const right: IndexedGroup[] = [];
    for (let i = 0; i < GROUPS.length; i++) {
      for (let j = i + 1; j < GROUPS.length; j++) {
        left.push(GROUPS[i]);
        right.push(GROUPS[j]);
      }
    }
    const conflictingPairs = left.filter((a, k) => conflicts(a, right[k])).length;

    const start = performance.now();
    let hits = 0;
    for (let round = 0; round < 10_000; round++) {
      for (let k = 0; k < left.length; k++) if (conflicts(left[k], right[k])) hits++;
    }
    const elapsed = performance.now() - start;

    expect(left).toHaveLength(378); // 28 groups choose 2
    expect(hits).toBe(conflictingPairs * 10_000); // keeps the loop from being optimized away
    expect(elapsed).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// Warning codes (runs last: checks every warning produced above)
// ---------------------------------------------------------------------------

describe("warning codes", () => {
  it("warns about a group without any session", () => {
    const courses = editableCourses();
    findGroup(courses, "CO2011", "A01").sessions = [];
    expect(buildMasks(courses).warnings).toEqual([
      { courseCode: "CO2011", groupId: "A01", message: "group has no sessions", code: "group-no-sessions", params: {} },
    ]);
  });

  it("every warning emitted by the tests above has a known code and params", () => {
    expect(emitted.length).toBeGreaterThanOrEqual(5);
    for (const warning of emitted) {
      expect(TIME_WARNING_CODES, warning.message).toContain(warning.code);
      expect(warning.params).toBeTypeOf("object");
    }
  });
});

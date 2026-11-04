import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, type Course } from "../src/lib/parser";
import { buildMasks, conflicts, type IndexedCourse, type IndexedGroup } from "../src/lib/timing";
import { programOf } from "../src/lib/parser";
import {
  applyConstraints,
  CONSTRAINTS,
  constraintsWithMode,
  createScorer,
  DEFAULT_PREFERENCES,
  equivalenceKey,
  groupFeatures,
  normalizePreferences,
  solve as solveRaw,
  SOLVER_DIAGNOSTIC_CODES,
  violates,
  type ConstraintName,
  type Preferences,
  type Schedule,
  type SolveResult,
} from "../src/lib/solver";

/** Every result the tests below produce; the last test checks that each diagnostic has a code. */
const results: SolveResult[] = [];
function solve(courses: IndexedCourse[], p: Preferences): SolveResult {
  const result = solveRaw(courses, p);
  results.push(result);
  return result;
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const FIXTURES = new URL("./fixtures/", import.meta.url);
const ALL_FIXTURES = readdirSync(FIXTURES).filter((name) => name.endsWith(".txt")).sort();

/** Parses real fixtures (no warnings expected). */
function parseFixtures(names: string[]): Course[] {
  return names.flatMap((name) => {
    const result = parse(readFileSync(new URL(name, FIXTURES), "utf8"));
    expect(result.warnings, name).toEqual([]);
    return result.courses;
  });
}

function index(courses: Course[]): IndexedCourse[] {
  const built = buildMasks(courses);
  expect(built.warnings).toEqual([]);
  return built.courses;
}

const BOTH = index(parseFixtures(["CO2007.txt", "CO2011.txt"]));
const CO2011_ONLY = index(parseFixtures(["CO2011.txt"]));

/** Default preferences with edits applied. */
function prefs(edit?: (p: Preferences) => void): Preferences {
  const p = structuredClone(DEFAULT_PREFERENCES);
  edit?.(p);
  return p;
}

/** All weights 0 and all constraint modes "off". */
function blank(p: Preferences): void {
  p.weights = {
    timeOfDay: { prefer: "none", weight: 0 },
    fewerDays: 0,
    compactDays: 0,
    noCampusSwitch: 0,
    avoidEarly: 0,
    preferredItems: 0,
  };
  for (const name of CONSTRAINTS) p[name].mode = "off";
}

const keysOf = (s: Schedule) => s.picks.map((p) => p.group.key);
const byKeyIn = (courses: IndexedCourse[], key: string): IndexedGroup => courses.flatMap((c) => c.groups).find((g) => g.key === key)!;
const allKeys = (r: SolveResult) => r.schedules.flatMap((s) => s.picks.flatMap((p) => [p.group.key, ...p.alternatives]));

function expectConflictFree(result: SolveResult): void {
  for (const schedule of result.schedules) {
    const groups = schedule.picks.map((p) => p.group);
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) expect(conflicts(groups[i], groups[j])).toBe(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Brute-force reference. Independent of search.ts / equivalence.ts / solve.ts:
// it enumerates every combination, then filters, checks conflicts and sorts
// itself. It shares only the constraint predicate (`violates`) and the scorer.
// ---------------------------------------------------------------------------

interface Ranked {
  keys: string[];
  penalty: number;
}

/** Groups allowed by excluded / locked / required rules. */
function referenceAllowed(course: IndexedCourse, p: Preferences): IndexedGroup[] {
  const required = CONSTRAINTS.filter((name) => p[name].mode === "required");
  return course.groups.filter(
    (g) =>
      !p.excluded.includes(g.key) &&
      (p.locked[course.code] === undefined || p.locked[course.code] === g.group.id) &&
      required.every((name) => !violates(name, g.group, p)),
  );
}

/** One group per class of "scores the same everywhere"; the smallest id represents it. */
function referenceCollapse(groups: IndexedGroup[], p: Preferences): IndexedGroup[] {
  const seen = new Set<string>();
  const sorted = [...groups].sort((a, b) => (a.group.id < b.group.id ? -1 : 1));
  return sorted.filter((g) => {
    const sessions = g.group.sessions.map((s) => JSON.stringify([s.day, s.periods, s.weeks, s.campus])).sort();
    const signature = JSON.stringify([
      Array.from(g.mask),
      sessions,
      g.group.language,
      violates("programs", g.group, p),
      g.group.registered >= g.group.capacity,
      violates("avoidLecturers", g.group, p),
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function compareKeyLists(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function bruteForce(courses: IndexedCourse[], p: Preferences): Ranked[] {
  const domains = courses.map((course) => referenceCollapse(referenceAllowed(course, p), p));
  const scorer = createScorer(p, []);
  const ranked: Ranked[] = [];

  const walk = (depth: number, chosen: IndexedGroup[]): void => {
    if (depth === domains.length) {
      const clash = chosen.some((a, i) => chosen.slice(i + 1).some((b) => conflicts(a, b)));
      if (clash) return;
      const picks = chosen.map((g) => ({ courseCode: g.courseCode, features: groupFeatures(g, p) }));
      ranked.push({ keys: chosen.map((g) => g.key), penalty: scorer.penalty(picks) });
      return;
    }
    for (const group of domains[depth]) walk(depth + 1, [...chosen, group]);
  };
  walk(0, []);

  ranked.sort((a, b) => a.penalty - b.penalty || compareKeyLists(a.keys, b.keys));
  return ranked.slice(0, p.topK);
}

function ranking(result: SolveResult): Ranked[] {
  return result.schedules.map((s) => ({ keys: keysOf(s), penalty: s.penalty }));
}

/** Each weight alone at 10 (everything else off), plus the constraint sets. */
const PREFERENCE_SETS: [string, Preferences][] = [
  ["defaults", prefs()],
  ["timeOfDay morning", prefs((p) => { blank(p); p.weights.timeOfDay = { prefer: "morning", weight: 10 }; })],
  ["timeOfDay afternoon", prefs((p) => { blank(p); p.weights.timeOfDay = { prefer: "afternoon", weight: 10 }; })],
  ["fewerDays", prefs((p) => { blank(p); p.weights.fewerDays = 10; })],
  ["compactDays", prefs((p) => { blank(p); p.weights.compactDays = 10; })],
  ["noCampusSwitch", prefs((p) => { blank(p); p.weights.noCampusSwitch = 10; })],
  ["avoidEarly", prefs((p) => { blank(p); p.weights.avoidEarly = 10; })],
  ["preferredItems (campus 1, V, free seats preferred)", prefs((p) => {
    blank(p);
    p.weights.preferredItems = 10;
    p.campuses = { mode: "preferred", allowed: [1] };
    p.language = { mode: "preferred", allowed: ["V"] };
    p.freeSeats = { mode: "preferred" };
  })],
  ["campus [1] required", prefs((p) => { p.campuses = { mode: "required", allowed: [1] }; })],
  ["daysOff [2] required", prefs((p) => { p.daysOff = { mode: "required", days: [2] }; })],
  ["freeSeats required", prefs((p) => { p.freeSeats = { mode: "required" }; })],
  ["programs [L] required", prefs((p) => { p.programs = { mode: "required", allowed: ["L"] }; })],
  ["programs [CC, TN] required", prefs((p) => { p.programs = { mode: "required", allowed: ["CC", "TN"] }; })],
  ["programs [L] preferred", prefs((p) => { blank(p); p.weights.preferredItems = 10; p.programs = { mode: "preferred", allowed: ["L"] }; })],
  ["partsOff morning of Thứ 2 required", prefs((p) => { p.partsOff = { mode: "required", parts: [{ day: 2, part: "morning" }] }; })],
  ["partsOff afternoon of Thứ 6 + evening of Thứ 3 required", prefs((p) => {
    p.partsOff = { mode: "required", parts: [{ day: 3, part: "evening" }, { day: 6, part: "afternoon" }] };
  })],
  ["partsOff preferred", prefs((p) => {
    blank(p);
    p.weights.preferredItems = 10;
    p.partsOff = { mode: "preferred", parts: [{ day: 2, part: "morning" }, { day: 5, part: "afternoon" }] };
  })],
];

// ---------------------------------------------------------------------------
// Correctness vs brute force
// ---------------------------------------------------------------------------

describe("solve matches the brute-force reference (CO2007 + CO2011)", () => {
  it("has a non-trivial search space", () => {
    const everything = bruteForce(BOTH, prefs((p) => { p.topK = 10_000; }));
    expect(everything.length).toBeGreaterThan(100); // conflict-free schedules out of 18 × 10
    expect(everything.length).toBeLessThan(180); // some combinations do conflict
  });

  it.each(PREFERENCE_SETS)("top-5 with %s", (_, p) => {
    const result = solve(BOTH, p);
    expect(result.status).toBe("ok");
    expect(ranking(result)).toEqual(bruteForce(BOTH, p));
  });

  it.each(PREFERENCE_SETS)("full ranking with %s", (_, base) => {
    const p = { ...base, topK: 10_000 };
    const result = solve(BOTH, p);
    expect(ranking(result)).toEqual(bruteForce(BOTH, p));
  });
});

// ---------------------------------------------------------------------------
// Scoring formulas, checked against values computed by hand from the fixtures.
// (The brute force shares score.ts, so these are what pin the formulas down.)
// ---------------------------------------------------------------------------

describe("scoring formulas", () => {
  const byKey = (key: string) => BOTH.flatMap((c) => c.groups).find((g) => g.key === key)!;
  const explain = (keys: string[], p: Preferences, relaxed: ConstraintName[] = []) =>
    createScorer(p, relaxed).explain(
      keys.map(byKey).map((g) => ({ courseCode: g.courseCode, features: groupFeatures(g, p) })),
    );
  const metric = (parts: ReturnType<typeof explain>, item: string) => parts.breakdown.find((b) => b.item === item)!.metric;

  it("CO2007:A01_A01 alone: Mon 2-4 × 15 weeks + Mon 8-12 × weeks 6,10,12,14", () => {
    const morning = explain(["CO2007:A01_A01"], prefs((p) => { p.weights.timeOfDay = { prefer: "morning", weight: 10 }; }));
    expect(metric(morning, "timeOfDay")).toBeCloseTo(20 / 65, 12); // 20 lab slots are not in 1-6
    expect(metric(morning, "fewerDays")).toBe(0); // Monday only, every active week
    expect(metric(morning, "compactDays")).toBeCloseTo(12 / 165, 12); // 3 idle (5-7) × 4 lab weeks / (15 × 11)
    expect(metric(morning, "noCampusSwitch")).toBe(0);
    expect(metric(morning, "avoidEarly")).toBeCloseTo(15 / 65, 12); // period 2 × 15 weeks

    const afternoon = explain(["CO2007:A01_A01"], prefs((p) => { p.weights.timeOfDay = { prefer: "afternoon", weight: 10 }; }));
    expect(metric(afternoon, "timeOfDay")).toBeCloseTo(45 / 65, 12);
  });

  it("CO2007:L01_L01 + CO2011:CC01: two days a week and a campus switch on lab Fridays", () => {
    // L01_L01: Tue 10-12 (CS2) all weeks, Fri 8-12 (CS2) weeks 7,9,11,13. CC01: Fri 2-3 (CS1) all weeks.
    const parts = explain(["CO2007:L01_L01", "CO2011:CC01"], prefs());
    expect(metric(parts, "fewerDays")).toBeCloseTo(1 / 6, 12);
    expect(metric(parts, "compactDays")).toBeCloseTo(16 / 330, 12); // 4 idle (4-7) × 4 Fridays / (30 × 11)
    expect(metric(parts, "noCampusSwitch")).toBeCloseTo(4 / 30, 12);
    expect(metric(parts, "avoidEarly")).toBeCloseTo(15 / 95, 12);
    expect(metric(parts, "timeOfDay")).toBe(0); // prefer "none"
    // Defaults: fewerDays 5, compactDays 3, noCampusSwitch 5, avoidEarly 3 → Σweights 16.
    const penalty = 5 / 6 + (3 * 16) / 330 + (5 * 4) / 30 + (3 * 15) / 95;
    expect(parts.penalty).toBeCloseTo(penalty, 9);
    expect(parts.score).toBe(87); // round(100 × (1 − 2.1191 / 16))
    expect(parts.violations).toEqual([]);
  });

  it("preferred items count toward score; relaxed items only toward penalty", () => {
    // CC02_CC03 is TA and full (40/40); CO2011:TN01 is V with free seats.
    const p = prefs((q) => {
      blank(q);
      q.weights.preferredItems = 10;
      q.language = { mode: "preferred", allowed: ["V"] };
      q.freeSeats = { mode: "required" };
    });
    const parts = explain(["CO2007:CC02_CC03", "CO2011:TN01"], p, ["freeSeats"]);
    expect(metric(parts, "language")).toBe(0.5);
    expect(metric(parts, "freeSeats")).toBe(0.5);
    expect(parts.penalty).toBe(10 * 0.5 + 1000 * 0.5);
    expect(parts.score).toBe(50); // only language (weight 10) is a soft item
    expect(parts.violations).toEqual([
      { item: "language", courses: ["CO2007"] },
      { item: "freeSeats", courses: ["CO2007"] },
    ]);
  });

  it("scores 100 when every weight is 0", () => {
    const parts = explain(["CO2007:A01_A01", "CO2011:A01"], prefs(blank));
    expect(parts).toMatchObject({ penalty: 0, score: 100 });
  });

  it("normalizes preferences: defaults unchanged, weights clamped to 0..10", () => {
    expect(normalizePreferences(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
    const odd = normalizePreferences(prefs((p) => {
      p.weights.fewerDays = 50;
      p.weights.avoidEarly = -3;
      p.topK = 0;
      (p.campuses as { mode: string }).mode = "sometimes";
    }));
    expect(odd.weights).toMatchObject({ fewerDays: 10, avoidEarly: 0 });
    expect(odd.topK).toBe(5);
    expect(odd.campuses.mode).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// Constraint behavior
// ---------------------------------------------------------------------------

describe("constraints (CO2007 + CO2011)", () => {
  const every = (edit: (p: Preferences) => void) => solve(BOTH, prefs((p) => { edit(p); p.topK = 10_000; }));

  it("campuses required [1] → every session is on campus 1", () => {
    const result = every((p) => { p.campuses = { mode: "required", allowed: [1] }; });
    expect(result.status).toBe("ok");
    const sessions = result.schedules.flatMap((s) => s.picks.flatMap((p) => p.group.group.sessions));
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.campus === 1)).toBe(true);
  });

  it("daysOff required [2] → no Monday session; CO2011 never L01/L02", () => {
    const result = every((p) => { p.daysOff = { mode: "required", days: [2] }; });
    expect(result.status).toBe("ok");
    for (const schedule of result.schedules) {
      expect(schedule.picks.flatMap((p) => p.group.group.sessions).some((s) => s.day === 2)).toBe(false);
    }
    expect(allKeys(result)).not.toContain("CO2011:L01");
    expect(allKeys(result)).not.toContain("CO2011:L02");
  });

  it("freeSeats required → full groups never appear as picks or alternatives", () => {
    const result = every((p) => { p.freeSeats = { mode: "required" }; });
    expect(result.status).toBe("ok");
    const keys = allKeys(result);
    for (const full of ["CO2007:CC02_CC03", "CO2007:CC02_CC04", "CO2007:CC03_CC06", "CO2007:TN01_TN01", "CO2011:CC05"]) {
      expect(keys).not.toContain(full);
    }
  });

  it("fewerDays alone → Friday-only {CO2007:CC02_CC03, CO2011:CC01} is the unique best", () => {
    const result = solve(BOTH, prefs((p) => { blank(p); p.weights.fewerDays = 10; }));
    const [best, second] = result.schedules;
    expect(keysOf(best)).toEqual(["CO2007:CC02_CC03", "CO2011:CC01"]);
    expect(best).toMatchObject({ penalty: 0, score: 100, violations: [] });
    expect(second.penalty).toBeGreaterThan(0);
  });

  it("timeOfDay afternoon alone, CO2011 only → CO2011:CC05", () => {
    const result = solve(CO2011_ONLY, prefs((p) => { p.weights.timeOfDay = { prefer: "afternoon", weight: 10 }; }));
    expect(keysOf(result.schedules[0])).toEqual(["CO2011:CC05"]);
    expect(result.schedules[0].breakdown.find((b) => b.item === "timeOfDay")?.metric).toBe(0);
  });

  it("locked group is always picked; excluded group never appears", () => {
    const result = every((p) => {
      p.locked = { CO2007: "L01_L01" };
      p.excluded = ["CO2011:CC01"];
    });
    expect(result.status).toBe("ok");
    expect(result.schedules.every((s) => s.picks[0].group.key === "CO2007:L01_L01")).toBe(true);
    expect(allKeys(result)).not.toContain("CO2011:CC01");
  });

  it("avoidLecturers matches names ignoring case and diacritics", () => {
    const courses = parseFixtures(["CO2011.txt"]);
    courses[0].groups[0].lecturer = "Nguyễn Văn A"; // A01, derived from the fixture
    const result = solve(index(courses), prefs((p) => {
      p.avoidLecturers = { mode: "required", names: ["nguyen van a"] };
      p.topK = 100;
    }));
    expect(result.status).toBe("ok");
    expect(result.schedules).toHaveLength(9);
    expect(allKeys(result)).not.toContain("CO2011:A01");
  });

  it("returns only conflict-free schedules for every preference set", () => {
    for (const [, p] of PREFERENCE_SETS) expectConflictFree(solve(BOTH, { ...p, topK: 10_000 }));
  });
});

// ---------------------------------------------------------------------------
// Program track (Phase 7)
// ---------------------------------------------------------------------------

const ALL_DAYS_2_TO_8 = [2, 3, 4, 5, 6, 7, 8] as const;

describe("programs (chuong trinh)", () => {
  const ALL = index(parseFixtures(ALL_FIXTURES));
  const programsOf = (result: SolveResult) =>
    new Set(result.schedules.flatMap((s) => s.picks.map((pick) => programOf(pick.group.group))));

  it("required [L] -> every pick and every alternative is an L group", () => {
    const result = solve(BOTH, prefs((p) => { p.programs = { mode: "required", allowed: ["L"] }; p.topK = 10_000; }));
    expect(result.status).toBe("ok");
    expect(programsOf(result)).toEqual(new Set(["L"]));
    for (const key of allKeys(result)) expect(key.split(":")[1].startsWith("L")).toBe(true);
    // CO2007 has 8 L groups and CO2011 has 3, so nothing outside them can appear.
    expect(allKeys(result)).not.toContain("CO2007:A01_A01");
    expect(allKeys(result)).not.toContain("CO2011:TN01");
  });

  it("required [CC, TN] keeps both programs and drops the others", () => {
    const result = solve(BOTH, prefs((p) => { p.programs = { mode: "required", allowed: ["CC", "TN"] }; p.topK = 10_000; }));
    expect(result.status).toBe("ok");
    expect(programsOf(result)).toEqual(new Set(["CC", "TN"]));
  });

  it("with nothing chosen it filters nothing, whatever the mode", () => {
    const off = solve(BOTH, prefs());
    for (const mode of ["required", "preferred"] as const) {
      const p = prefs((q) => { q.programs = { mode, allowed: [] }; });
      expect(constraintsWithMode(p, mode)).not.toContain("programs");
      const result = solve(BOTH, p);
      expect(ranking(result)).toEqual(ranking(off));
      expect(result.relaxed).toEqual([]);
    }
    // The predicate agrees: no group breaks a program filter that is empty.
    const empty = prefs((q) => { q.programs = { mode: "required", allowed: [] }; });
    expect(BOTH[0].groups.some((g) => violates("programs", g.group, empty))).toBe(false);
  });

  it("does not collapse two same-time groups of different programs", () => {
    // Derived: a copy of CO2011:CC01 (Fri 2-3) registered under an L id, so the
    // only difference between the two groups is the program.
    const courses = parseFixtures(["CO2011.txt"]);
    const copy = structuredClone(courses[0].groups.find((g) => g.id === "CC01")!);
    copy.id = "L09";
    copy.theoryGroup = "L09";
    courses[0].groups.push(copy);
    const indexed = index(courses);
    const withFilter = prefs((p) => { p.programs = { mode: "required", allowed: ["L"] }; });
    expect(equivalenceKey(byKeyIn(indexed, "CO2011:CC01"), withFilter)).not.toBe(
      equivalenceKey(byKeyIn(indexed, "CO2011:L09"), withFilter),
    );
    const result = solve(indexed, { ...withFilter, topK: 100 });
    expect(allKeys(result)).toContain("CO2011:L09");
    expect(allKeys(result)).not.toContain("CO2011:CC01");
  });

  it(`required [L] on all ${ALL_FIXTURES.length} fixtures: SK2001 triggers the missing-program diagnostic`, () => {
    const result = solve(ALL, prefs((p) => { p.programs = { mode: "required", allowed: ["L"] }; }));
    // SK2001 has only A and CC groups, so the strict attempt cannot use it.
    const missing = result.diagnosticDetails.filter((d) => d.code === "course-no-program");
    expect(missing).toHaveLength(1);
    expect(missing[0].params).toEqual({ course: "SK2001", allowed: ["L"], available: ["A", "CC"] });
    expect(missing[0].message).toContain("SK2001");
    // The course really has no L group; every other fixture does.
    for (const course of ALL) {
      const programs = new Set(course.groups.map((g) => programOf(g.group)));
      expect(programs.has("L"), course.code).toBe(course.code !== "SK2001");
    }
    // The filter is then relaxed rather than failing outright.
    expect(result.status).toBe("relaxed");
    expect(result.relaxed).toEqual(["programs"]);
  });

  it("names the other blocking requirements separately from the program one", () => {
    const result = solve(ALL, prefs((p) => {
      p.programs = { mode: "required", allowed: ["L"] };
      p.language = { mode: "required", allowed: ["TA"] }; // no fixture group is TA
    }));
    const codes = result.diagnosticDetails.filter((d) => d.params.course === "SK2001").map((d) => d.code);
    expect(codes).toEqual(["course-no-program", "course-blocked"]);
    const blocked = result.diagnosticDetails.find((d) => d.code === "course-blocked" && d.params.course === "SK2001")!;
    expect(blocked.params.constraints).toEqual(["language"]); // "programs" is not repeated here
  });
});

// ---------------------------------------------------------------------------
// Half-day off (Phase 7)
// ---------------------------------------------------------------------------

describe("partsOff (buoi nghi)", () => {
  const withParts = (parts: Preferences["partsOff"]["parts"]) =>
    prefs((p) => { p.partsOff = { mode: "required", parts }; });

  it("a group is caught by the half-day its periods fall in, and by no other", () => {
    // CO2011:L01 meets Thu 2 tiet 2-3 only, so only the morning of Thu 2 hits it.
    const l01 = byKeyIn(CO2011_ONLY, "CO2011:L01").group;
    expect(l01.sessions.filter((s) => s.day === 2).flatMap((s) => s.periods).every((n) => n <= 6)).toBe(true);
    expect(violates("partsOff", l01, withParts([{ day: 2, part: "morning" }]))).toBe(true);
    expect(violates("partsOff", l01, withParts([{ day: 2, part: "afternoon" }]))).toBe(false);
    expect(violates("partsOff", l01, withParts([{ day: 2, part: "evening" }]))).toBe(false);
    expect(violates("partsOff", l01, withParts([{ day: 3, part: "morning" }]))).toBe(false); // same part, other day

    // CO2007:CC01_CC01 meets Thu 2 in the afternoon only - the mirror case.
    const cc01 = byKeyIn(BOTH, "CO2007:CC01_CC01").group;
    expect(violates("partsOff", cc01, withParts([{ day: 2, part: "morning" }]))).toBe(false);
    expect(violates("partsOff", cc01, withParts([{ day: 2, part: "afternoon" }]))).toBe(true);
  });

  it("whole day off and the three parts filter the same groups, but stay separate constraints", () => {
    const groups = BOTH.flatMap((c) => c.groups);
    const allThree = withParts([
      { day: 2, part: "morning" },
      { day: 2, part: "afternoon" },
      { day: 2, part: "evening" },
    ]);
    const wholeDay = prefs((p) => { p.daysOff = { mode: "required", days: [2] }; });
    // Periods 1-16 are covered by the three buckets, so the results coincide...
    expect(groups.filter((g) => violates("partsOff", g.group, allThree)).map((g) => g.key)).toEqual(
      groups.filter((g) => violates("daysOff", g.group, wholeDay)).map((g) => g.key),
    );
    expect(groups.filter((g) => violates("partsOff", g.group, allThree))).not.toHaveLength(0);
    // ...but neither constraint reads the other's list: picking all three parts does not set daysOff.
    expect(allThree.daysOff.days).toEqual([]);
    expect(groups.some((g) => violates("daysOff", g.group, allThree))).toBe(false);
    expect(groups.some((g) => violates("partsOff", g.group, wholeDay))).toBe(false);
  });

  it("afternoon of Thu 6 off on CO2007: exactly the groups without a Friday 7-12 session survive", () => {
    const p = withParts([{ day: 6, part: "afternoon" }]);
    // Expected list computed here from the parsed sessions, not from the solver.
    const expected = BOTH[0].groups
      .filter((g) => !g.group.sessions.some((s) => s.day === 6 && s.periods.some((n) => n >= 7 && n <= 12)))
      .map((g) => g.group.id);
    expect(expected).toEqual([
      "A01_A01", "CC01_CC01", "CC01_CC02", "CC02_CC04", "CC04_CC07",
      "L01_L02", "L03_L05", "L03_L06", "L04_L07", "L04_L08", "TN01_TN01",
    ]);
    expect(applyConstraints(BOTH[0].groups, ["partsOff"], p).map((g) => g.group.id)).toEqual(expected);

    const result = solve(BOTH, { ...p, topK: 10_000 });
    expect(result.status).toBe("ok");
    const sessions = result.schedules.flatMap((s) => s.picks.flatMap((pick) => pick.group.group.sessions));
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.some((s) => s.day === 6 && s.periods.some((n) => n >= 7 && n <= 12))).toBe(false);
  });

  it("evening (tiet 13-16) is its own bucket, and nothing selected filters nothing", () => {
    const groups = BOTH.flatMap((c) => c.groups);
    // No fixture group teaches after tiet 12, so an evening-only selection keeps them all.
    const everyEvening = withParts(ALL_DAYS_2_TO_8.map((day) => ({ day, part: "evening" as const })));
    expect(applyConstraints(groups, ["partsOff"], everyEvening)).toHaveLength(groups.length);
    const empty = withParts([]);
    expect(constraintsWithMode(empty, "required")).not.toContain("partsOff");
    expect(ranking(solve(BOTH, empty))).toEqual(ranking(solve(BOTH, prefs())));
  });
});

// ---------------------------------------------------------------------------
// Relaxation / infeasible
// ---------------------------------------------------------------------------

describe("relaxation and infeasibility", () => {
  it("relaxes campus [2] + TA, which no group satisfies together", () => {
    const result = solve(BOTH, prefs((p) => {
      p.campuses = { mode: "required", allowed: [2] };
      p.language = { mode: "required", allowed: ["TA"] };
    }));
    expect(result.status).toBe("relaxed");
    expect(result.relaxed).toEqual(["campuses", "language"]);
    expect(result.schedules.length).toBeGreaterThan(0);
    for (const schedule of result.schedules) {
      expect(schedule.violations.length).toBeGreaterThan(0);
      expect(schedule.penalty).toBeGreaterThanOrEqual(1000);
    }
    const text = result.diagnostics.join("\n");
    expect(text).toContain("CO2007");
    expect(text).toContain("CO2011");
    expectConflictFree(result);
  });

  it("reports conflicting locked groups as infeasible", () => {
    const result = solve(BOTH, prefs((p) => { p.locked = { CO2007: "A01_A01", CO2011: "L01" }; }));
    expect(result.status).toBe("infeasible");
    expect(result.schedules).toEqual([]);
    const text = result.diagnostics.join("\n");
    expect(text).toContain("CO2007:A01_A01");
    expect(text).toContain("CO2011:L01");
    expect(text).toMatch(/Monday.*periods 2-3/);
  });

  it("reports a course with every group excluded as infeasible", () => {
    const result = solve(BOTH, prefs((p) => { p.excluded = BOTH[0].groups.map((g) => g.key); }));
    expect(result.status).toBe("infeasible");
    expect(result.diagnostics.join("\n")).toContain("CO2007");
  });
});

// ---------------------------------------------------------------------------
// Equivalence
// ---------------------------------------------------------------------------

describe("equivalent groups", () => {
  /** CO2011 with a copy of CC01 (Fri 2-3, 37/80, TA) added under a new id. */
  function withCopyOfCC01(edit?: (copy: Course["groups"][number]) => void): IndexedCourse[] {
    const courses = parseFixtures(["CO2011.txt"]);
    const copy = structuredClone(courses[0].groups[1]);
    copy.id = "CC06";
    copy.theoryGroup = "CC06";
    edit?.(copy);
    courses[0].groups.push(copy);
    return index(courses);
  }

  it("collapses identical groups into one candidate with alternatives", () => {
    const p = prefs((q) => { q.topK = 100; });
    const result = solve(withCopyOfCC01(), p);
    expect(result.schedules).toHaveLength(10); // 11 groups, 10 classes
    const pick = result.schedules.flatMap((s) => s.picks).find((x) => x.group.key === "CO2011:CC01");
    expect(pick?.alternatives).toEqual(["CO2011:CC06"]);
    expect(result.schedules.some((s) => keysOf(s).includes("CO2011:CC06"))).toBe(false);
    expect(ranking(result)).toEqual(bruteForce(withCopyOfCC01(), p));
  });

  it("does not collapse groups whose free-seats status differs", () => {
    const courses = withCopyOfCC01((copy) => { copy.registered = copy.capacity; });
    const result = solve(courses, prefs((q) => { q.topK = 100; }));
    expect(result.schedules).toHaveLength(11);
    expect(allKeys(result).filter((k) => k === "CO2011:CC06")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Other
// ---------------------------------------------------------------------------

describe("other", () => {
  it("orders courses by MRV: CO2011 (10 classes) before CO2007 (18)", () => {
    // Every node is one candidate tried. With forward checking only live
    // candidates are tried: all 10 of CO2011 at depth 0, then under each of
    // them the CO2007 groups it does not clash with. CO2007 first would give
    // 18 + the same pair count instead.
    const [co2007, co2011] = BOTH;
    const compatiblePairs = co2011.groups.flatMap((a) => co2007.groups.filter((b) => !conflicts(a, b))).length;
    expect(co2007.groups).toHaveLength(18);
    expect(co2011.groups).toHaveLength(10);
    expect(solve(BOTH, prefs()).stats.nodes).toBe(10 + compatiblePairs);
  });

  it("is deterministic", () => {
    const p = prefs();
    const first = solve(BOTH, p);
    const second = solve(BOTH, p);
    expect(second.schedules).toEqual(first.schedules);
    expect(second.status).toBe(first.status);
  });

  it("stops at maxNodes = 1 without throwing", () => {
    let result: SolveResult | undefined;
    expect(() => (result = solve(BOTH, prefs((p) => { p.maxNodes = 1; })))).not.toThrow();
    expect(result!.stats.truncated).toBe(true);
    expect(result!.stats.nodes).toBeLessThanOrEqual(1);
    expect(result!.diagnostics.join("\n")).toContain("maxNodes");
  });

  it("never throws on malformed preferences or input", () => {
    expect(() => solve(BOTH, {} as Preferences)).not.toThrow();
    expect(solve(BOTH, {} as Preferences).status).toBe("ok");
    expect(solve([], prefs()).schedules).toEqual([]);
    expect(() => solve(undefined as unknown as IndexedCourse[], prefs())).not.toThrow();
  });

  it(`solves all ${ALL_FIXTURES.length} fixtures with defaults in under 2 seconds`, () => {
    const courses = index(parseFixtures(ALL_FIXTURES));
    const result = solve(courses, prefs());
    console.log(
      `[perf] fixtures=${ALL_FIXTURES.length} courses=${courses.length} nodes=${result.stats.nodes} ms=${result.stats.ms.toFixed(1)}`,
    );
    expect(result.status).toBe("ok");
    expect(result.stats.truncated).toBe(false);
    expect(result.stats.ms).toBeLessThan(2000);
    expectConflictFree(result);
  });
});

// ---------------------------------------------------------------------------
// Diagnostic codes (runs last: checks every result produced above)
// ---------------------------------------------------------------------------

describe("diagnostic codes", () => {
  it("every diagnostic emitted by the tests above has a known code, in step with the English text", () => {
    const details = results.flatMap((r) => r.diagnosticDetails);
    expect(details.length).toBeGreaterThanOrEqual(5);
    for (const result of results) {
      expect(result.diagnosticDetails.map((d) => d.message)).toEqual(result.diagnostics);
    }
    for (const detail of details) {
      expect(SOLVER_DIAGNOSTIC_CODES, detail.message).toContain(detail.code);
      expect(detail.params).toBeTypeOf("object");
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROGRAM_CODES, parse, programOf, type Course, type Group, type Session } from "../src/lib/parser";
import {
  CONSTRAINTS,
  DEFAULT_PREFERENCES,
  normalizePreferences,
  solve,
  type Preferences,
  type Schedule,
  type SolveResult,
} from "../src/lib/solver";
import { buildMasks, type IndexedCourse } from "../src/lib/timing";
import {
  buildPreferences,
  effectiveMode,
  initialPreferencesState,
  isPaused,
  type GridCell,
  type GroupChoices,
  type PreferencesState,
} from "../src/model";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

function indexed(names: string[]): IndexedCourse[] {
  const courses = names.flatMap((name) => {
    const result = parse(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8"));
    expect(result.warnings, name).toEqual([]);
    return result.courses;
  });
  const built = buildMasks(courses);
  expect(built.warnings).toEqual([]);
  return built.courses;
}

/** Every program exists in both courses (docs/ui-change-analysis.md Q1), so no program is relaxed. */
const BOTH = indexed(["CO2007", "CO2011"]);

const NO_CHOICES: GroupChoices = { locked: {}, excluded: [] };

/** A step-3 state for `program`, with edits applied. */
function state(edit?: (s: PreferencesState) => void, program: string | null = "L"): PreferencesState {
  const s = initialPreferencesState(program);
  edit?.(s);
  return s;
}

function build(s: PreferencesState, choices: GroupChoices = NO_CHOICES): Preferences {
  const p = buildPreferences(s, choices);
  expect(p).not.toBeNull();
  return p!;
}

const keysOf = (s: Schedule) => s.picks.map((p) => p.group.key);
const ranking = (r: SolveResult) => r.schedules.map((s) => ({ keys: keysOf(s), penalty: s.penalty }));
const everyKey = (r: SolveResult) => r.schedules.flatMap((s) => s.picks.flatMap((p) => [p.group.key, ...p.alternatives]));

/** Runs `p` over `courses`, asking for the 10 best (the UI's largest stepper value). */
function solveTop(courses: IndexedCourse[], p: Preferences): SolveResult {
  return solve(courses, { ...p, topK: 10 });
}

/** The object docs/ui-change-analysis.md A2 describes, written out by hand. */
function a2Object(program: string): Preferences {
  const p = structuredClone(DEFAULT_PREFERENCES);
  p.programs = { mode: "required", allowed: [program] };
  p.campuses = { mode: "off", allowed: [1, 2] };
  p.language = { mode: "off", allowed: ["V", "TA"] };
  p.avoidLecturers = { mode: "off", names: [] };
  p.daysOff = { mode: "off", days: [] };
  p.weights.compactDays = 0;
  p.weights.noCampusSwitch = 0;
  p.weights.preferredItems = 5;
  return p;
}

/** A course whose groups are written by hand, for cases the real fixtures cannot show. */
function syntheticCourse(code: string, groups: { id: string; sessions: [Session["day"], number[]][]; lecturer?: string }[]): IndexedCourse[] {
  const session = (day: Session["day"], periods: number[]): Session => ({
    day,
    periods,
    room: "A1-101",
    campus: 2,
    labField: null,
    weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    kind: "theory",
  });
  const group = (g: (typeof groups)[number]): Group => ({
    id: g.id,
    theoryGroup: g.id,
    practiceGroup: null,
    registered: 10,
    capacity: 40,
    language: "V",
    lecturer: g.lecturer ?? null,
    labLecturer: null,
    theoryClassSize: 40,
    sessions: g.sessions.map(([day, periods]) => session(day, periods)),
  });
  const course: Course = { code, name: "Synthetic", credits: 3, groups: groups.map(group) };
  const built = buildMasks([course]);
  expect(built.warnings).toEqual([]);
  return built.courses;
}

// ---------------------------------------------------------------------------
// The object itself
// ---------------------------------------------------------------------------

describe("buildPreferences: the object the screen sends", () => {
  it.each(PROGRAM_CODES)("for program %s, is exactly the A2 object that the step-3 payload test verifies", (program) => {
    expect(build(state(undefined, program))).toEqual(a2Object(program));
  });

  it("solves every program on the real fixtures: ok, nothing relaxed, no violation, only weighted items in the penalty", () => {
    for (const program of PROGRAM_CODES) {
      const result = solve(BOTH, build(state(undefined, program)));
      expect(result.status, program).toBe("ok");
      expect(result.relaxed, program).toEqual([]);
      expect(result.schedules.length, program).toBeGreaterThan(0);
      for (const schedule of result.schedules) {
        expect(schedule.violations, program).toEqual([]);
        const weighted = schedule.breakdown.filter((b) => b.weight > 0);
        expect(schedule.penalty, program).toBeCloseTo(weighted.reduce((sum, b) => sum + b.penalty, 0), 9);
        for (const item of schedule.breakdown.filter((b) => b.weight === 0)) expect(item.penalty, program).toBe(0);
      }
    }
  });

  it("returns null until a program is chosen, instead of an object whose empty list filters nothing", () => {
    expect(buildPreferences(state(undefined, null), NO_CHOICES)).toBeNull();
    expect(buildPreferences(state(undefined, ""), NO_CHOICES)).toBeNull();
  });

  it("keeps a program code it does not know as the single required code", () => {
    expect(build(state(undefined, "XYZ")).programs).toEqual({ mode: "required", allowed: ["XYZ"] });
  });

  it("is already normalized: solve never has to repair anything the builder produced", () => {
    const busy = state((s) => {
      s.partsOff = {
        mode: "required",
        cells: [
          { day: 7, part: "morning" },
          { day: 2, part: "afternoon" },
          { day: 2, part: "morning" },
        ],
      };
      s.freeSeats.mode = "preferred";
      s.timeOfDay = { prefer: "afternoon", weight: 6 };
      s.topK = 7;
    });
    const p = build(busy, { locked: { CO2007: "L01_L01" }, excluded: ["CO2011:CC01"] });
    expect(normalizePreferences(p)).toEqual(p);
  });

  it("shares nothing with its inputs", () => {
    const choices: GroupChoices = { locked: { CO2007: "L01_L01" }, excluded: ["CO2011:CC01"] };
    const s = state((x) => { x.partsOff = { mode: "required", cells: [{ day: 2, part: "morning" }] }; });
    const p = build(s, choices);
    p.excluded.push("CO2011:CC02");
    p.locked.CO2011 = "CC03";
    p.partsOff.parts.length = 0;
    p.programs.allowed.push("A");
    expect(choices).toEqual({ locked: { CO2007: "L01_L01" }, excluded: ["CO2011:CC01"] });
    expect(s.partsOff.cells).toHaveLength(1);
    expect(DEFAULT_PREFERENCES.programs.allowed).toEqual([]);
  });

  it("clamps the numbers the sliders and the stepper produce, and sends topK as a number", () => {
    const p = build(state((s) => { s.fewerDays = 15; s.avoidEarly = -3; s.topK = 99; }));
    expect(p.weights.fewerDays).toBe(10);
    expect(p.weights.avoidEarly).toBe(0);
    expect(p.topK).toBe(10);
    for (const [given, expected] of [[0, 1], [1, 1], [4.7, 4], [10, 10], [Number.NaN, 5], ["5" as unknown as number, 5]] as const) {
      const topK = build(state((s) => { s.topK = given; })).topK;
      expect(topK, String(given)).toBe(expected);
      expect(typeof topK).toBe("number");
    }
  });

  it("sends the time-of-day weight as 0 while the radio says Không, and keeps it otherwise", () => {
    expect(build(state((s) => { s.timeOfDay = { prefer: "none", weight: 7 }; })).weights.timeOfDay).toEqual({ prefer: "none", weight: 0 });
    expect(build(state((s) => { s.timeOfDay = { prefer: "morning", weight: 7 }; })).weights.timeOfDay).toEqual({ prefer: "morning", weight: 7 });
    // The state keeps 7 for when the student picks Sáng again (B5): the builder must not change it.
    const s = state((x) => { x.timeOfDay = { prefer: "none", weight: 7 }; });
    build(s);
    expect(s.timeOfDay.weight).toBe(7);
  });

  it("zeroes compactDays and noCampusSwitch, whose defaults are 3 and 5", () => {
    expect(DEFAULT_PREFERENCES.weights.compactDays).toBe(3);
    expect(DEFAULT_PREFERENCES.weights.noCampusSwitch).toBe(5);
    const w = build(state()).weights;
    expect(w.compactDays).toBe(0);
    expect(w.noCampusSwitch).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The "Ngày/buổi nghỉ" grid and the evening rule
// ---------------------------------------------------------------------------

describe("Ngày/buổi nghỉ grid", () => {
  const partsOf = (cells: GridCell[]) =>
    build(state((s) => { s.partsOff = { mode: "required", cells }; })).partsOff.parts;

  it("sends one ticked cell as exactly that cell", () => {
    expect(partsOf([{ day: 2, part: "morning" }])).toEqual([{ day: 2, part: "morning" }]);
    expect(partsOf([{ day: 8, part: "afternoon" }])).toEqual([{ day: 8, part: "afternoon" }]);
  });

  it("adds the evening part when both cells of a day are ticked", () => {
    expect(
      partsOf([
        { day: 2, part: "morning" },
        { day: 2, part: "afternoon" },
      ]),
    ).toEqual([
      { day: 2, part: "morning" },
      { day: 2, part: "afternoon" },
      { day: 2, part: "evening" },
    ]);
  });

  it("adds it per day, and only for the days with both cells ticked", () => {
    expect(
      partsOf([
        { day: 6, part: "afternoon" },
        { day: 3, part: "afternoon" },
        { day: 3, part: "morning" },
        { day: 8, part: "morning" },
        { day: 8, part: "afternoon" },
        { day: 3, part: "morning" }, // a duplicate
      ]),
    ).toEqual([
      { day: 3, part: "morning" },
      { day: 3, part: "afternoon" },
      { day: 3, part: "evening" },
      { day: 6, part: "afternoon" },
      { day: 8, part: "morning" },
      { day: 8, part: "afternoon" },
      { day: 8, part: "evening" },
    ]);
  });

  it("drops the evening part as soon as one of the two cells is unticked (it is never stored)", () => {
    const both: GridCell[] = [
      { day: 4, part: "morning" },
      { day: 4, part: "afternoon" },
    ];
    expect(partsOf(both)).toHaveLength(3);
    expect(partsOf(both.slice(0, 1))).toEqual([{ day: 4, part: "morning" }]);
  });

  it("ignores an evening cell or a bad day in restored state: evening is only ever derived", () => {
    const stale = [
      { day: 2, part: "evening" },
      { day: 9, part: "morning" },
      { day: 2, part: "morning" },
    ] as unknown as PreferencesState["partsOff"]["cells"];
    expect(partsOf(stale)).toEqual([{ day: 2, part: "morning" }]);
  });

  it("sends mode off for an empty grid whatever is stored (B8, rule 2), and gives the mode back when a cell is ticked", () => {
    const empty = state((s) => { s.partsOff = { mode: "required", cells: [] }; });
    expect(effectiveMode(empty, "partsOff")).toBe("off");
    expect(build(empty).partsOff).toEqual({ mode: "off", parts: [] });
    const ticked = state((s) => { s.partsOff = { mode: "required", cells: [{ day: 2, part: "morning" }] }; });
    expect(effectiveMode(ticked, "partsOff")).toBe("required");
  });

  describe("through solve", () => {
    // Monday evening (periods 13-14) in L01, Tuesday morning in L02. No real fixture uses periods 13-16.
    const SYNTHETIC = syntheticCourse("ZZ0001", [
      { id: "L01", sessions: [[2, [13, 14]]] },
      { id: "L02", sessions: [[3, [2, 3]]] },
    ]);
    const mondayOff = (cells: GridCell[]) =>
      build(state((s) => { s.partsOff = { mode: "required", cells }; }));

    it("with both Monday cells ticked, a group that meets only on Monday evening is excluded", () => {
      const result = solveTop(SYNTHETIC, mondayOff([{ day: 2, part: "morning" }, { day: 2, part: "afternoon" }]));
      expect(result.status).toBe("ok");
      expect(result.schedules.map(keysOf)).toEqual([["ZZ0001:L02"]]);
    });

    it("with only the Monday morning cell ticked, the Monday-evening group is still allowed", () => {
      const result = solveTop(SYNTHETIC, mondayOff([{ day: 2, part: "morning" }]));
      expect(result.status).toBe("ok");
      expect(result.schedules.map(keysOf).sort()).toEqual([["ZZ0001:L01"], ["ZZ0001:L02"]]);
    });

    it("on the real fixtures, a whole day ticked leaves no session on that day in any pick", () => {
      const p = mondayOff([{ day: 2, part: "morning" }, { day: 2, part: "afternoon" }]);
      const result = solveTop(BOTH, p);
      expect(result.status).toBe("ok");
      expect(result.schedules.length).toBeGreaterThan(0);
      for (const schedule of result.schedules) {
        for (const pick of schedule.picks) expect(pick.group.group.sessions.map((x) => x.day)).not.toContain(2);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// The preferred-items switch (B3)
// ---------------------------------------------------------------------------

describe("preferred-items switch", () => {
  const withPreferred = (on: boolean) =>
    state((s) => {
      s.preferredSwitch = on;
      s.freeSeats = { mode: "preferred" };
      s.partsOff = { mode: "preferred", cells: [{ day: 2, part: "morning" }, { day: 5, part: "afternoon" }] };
    });

  it("on: both controls are sent as preferred and preferredItems is 5", () => {
    const p = build(withPreferred(true));
    expect(p.freeSeats.mode).toBe("preferred");
    expect(p.partsOff.mode).toBe("preferred");
    expect(p.weights.preferredItems).toBe(5);
  });

  it("off: a control the student had set to Ưu tiên is sent as off, and preferredItems is 0", () => {
    const s = withPreferred(false);
    const p = build(s);
    expect(p.freeSeats.mode).toBe("off");
    expect(p.partsOff.mode).toBe("off");
    expect(p.weights.preferredItems).toBe(0);
    expect(isPaused(s, "freeSeats")).toBe(true);
    expect(isPaused(s, "partsOff")).toBe(true);
  });

  it("off: the ticked cells are kept in the state and in the payload, so nothing the student chose is lost", () => {
    const s = withPreferred(false);
    expect(build(s).partsOff.parts).toEqual([{ day: 2, part: "morning" }, { day: 5, part: "afternoon" }]);
    expect(s.partsOff.cells).toHaveLength(2);
  });

  it("is remembered with no extra field: switching back on restores Ưu tiên from the same state", () => {
    const on = withPreferred(true);
    const off = { ...on, preferredSwitch: false };
    expect(build(off).freeSeats.mode).toBe("off");
    expect(build({ ...off, preferredSwitch: true })).toEqual(build(on));
  });

  it("forgets the memory when the student picks another mode meanwhile", () => {
    const required = { ...withPreferred(false), freeSeats: { mode: "required" as const } };
    expect(effectiveMode(required, "freeSeats")).toBe("required");
    expect(isPaused(required, "freeSeats")).toBe(false);
    const off = { ...withPreferred(false), freeSeats: { mode: "off" as const } };
    expect(isPaused(off, "freeSeats")).toBe(false);
    expect(effectiveMode({ ...off, preferredSwitch: true }, "freeSeats")).toBe("off"); // not restored to preferred
  });

  it("never touches Bắt buộc", () => {
    const s = state((x) => { x.preferredSwitch = false; x.freeSeats = { mode: "required" }; });
    expect(build(s).freeSeats.mode).toBe("required");
  });

  describe("through solve", () => {
    // A full group locked in: with the switch on its freeSeats violation is reported; with it off, nothing is.
    const full = BOTH.flatMap((c) => c.groups).find((g) => g.group.registered >= g.group.capacity);

    it("has a full group in the fixtures to lock", () => {
      expect(full).toBeDefined();
    });

    it("off reports no violation for it, which a preferred item with weight 0 would still have done (B3)", () => {
      const program = programOf(full!.group);
      const choices: GroupChoices = { locked: { [full!.courseCode]: full!.group.id }, excluded: [] };
      const preferFreeSeats = (switchOn: boolean) =>
        build(state((s) => { s.preferredSwitch = switchOn; s.freeSeats = { mode: "preferred" }; }, program), choices);

      const on = solve(BOTH, preferFreeSeats(true));
      expect(on.status).toBe("ok");
      expect(on.schedules.every((s) => s.violations.some((v) => v.item === "freeSeats" && v.courses.includes(full!.courseCode)))).toBe(true);

      const off = solve(BOTH, preferFreeSeats(false));
      expect(off.status).toBe("ok");
      expect(off.schedules.length).toBeGreaterThan(0);
      for (const schedule of off.schedules) expect(schedule.violations).toEqual([]);
    });

    it("off ranks exactly like a control the student set to Tắt", () => {
      for (const program of PROGRAM_CODES) {
        const pausedPrefer = build(state((s) => { s.preferredSwitch = false; s.freeSeats = { mode: "preferred" }; }, program));
        const chosenOff = build(state((s) => { s.preferredSwitch = true; s.freeSeats = { mode: "off" }; }, program));
        expect(ranking(solveTop(BOTH, pausedPrefer)), program).toEqual(ranking(solveTop(BOTH, chosenOff)));
      }
    });
  });
});

// ---------------------------------------------------------------------------
// locked and excluded (G16)
// ---------------------------------------------------------------------------

describe("locked and excluded", () => {
  const program = "CC";
  const courseA = BOTH[0];
  const courseB = BOTH[1];
  const lockedGroup = courseA.groups.find((g) => programOf(g.group) === program)!;

  it("carries both over in their own formats: a bare id per course, full keys in a list", () => {
    const p = build(state(undefined, program), { locked: { [courseA.code]: lockedGroup.group.id }, excluded: [`${courseB.code}:${courseB.groups[0].group.id}`] });
    expect(p.locked).toEqual({ [courseA.code]: lockedGroup.group.id });
    expect(Object.values(p.locked).every((id) => !id.includes(":"))).toBe(true);
    expect(p.excluded).toEqual([courseB.groups[0].key]);
    expect(p.excluded.every((key) => /^[^:]+:.+$/.test(key))).toBe(true);
  });

  it("makes the solver keep the locked group and never use an excluded one (also as an alternative)", () => {
    const baseline = solveTop(BOTH, build(state(undefined, program), { locked: { [courseA.code]: lockedGroup.group.id }, excluded: [] }));
    expect(baseline.status).toBe("ok");
    // Exclude the group the best schedule used for the other course, so the exclusion has something to remove.
    const best = baseline.schedules[0].picks.find((pick) => pick.courseCode === courseB.code)!.group;
    expect(everyKey(baseline)).toContain(best.key);

    const result = solveTop(BOTH, build(state(undefined, program), { locked: { [courseA.code]: lockedGroup.group.id }, excluded: [best.key as `${string}:${string}`] }));
    expect(result.status).toBe("ok");
    expect(result.schedules.length).toBeGreaterThan(0);
    for (const schedule of result.schedules) {
      expect(schedule.picks.find((pick) => pick.courseCode === courseA.code)!.group.group.id).toBe(lockedGroup.group.id);
    }
    expect(everyKey(result)).not.toContain(best.key);
  });

  it("shows why the formats must not be swapped: a key in `locked` names no group, a bare id in `excluded` excludes nothing", () => {
    const wrongLock = solve(BOTH, build(state(undefined, program), { locked: { [courseA.code]: lockedGroup.key }, excluded: [] }));
    expect(wrongLock.status).toBe("infeasible");
    expect(wrongLock.diagnosticDetails.map((d) => d.code)).toContain("locked-missing");

    const target = solveTop(BOTH, build(state(undefined, program))).schedules[0].picks[0].group;
    // @ts-expect-error a bare group id is not a group key: the compiler rejects it
    const bareExcluded: GroupChoices = { locked: {}, excluded: [target.group.id] };
    expect(everyKey(solveTop(BOTH, build(state(undefined, program), bareExcluded)))).toContain(target.key);
  });
});

// ---------------------------------------------------------------------------
// The hidden constraints are inert (A1, A3, B4)
// ---------------------------------------------------------------------------

describe("hidden constraints", () => {
  /** The same object with the four hidden constraints deleted, as if the UI had never heard of them. */
  function withoutHidden(p: Preferences): Preferences {
    const copy: Partial<Preferences> = structuredClone(p);
    delete copy.campuses;
    delete copy.language;
    delete copy.avoidLecturers;
    delete copy.daysOff;
    return copy as Preferences;
  }

  const sets: [string, PreferencesState][] = [
    ...PROGRAM_CODES.map((program): [string, PreferencesState] => [`program ${program}`, state(undefined, program)]),
    ["program L with time off, free seats and a time of day", state((s) => {
      s.partsOff = { mode: "preferred", cells: [{ day: 2, part: "morning" }, { day: 5, part: "afternoon" }] };
      s.freeSeats = { mode: "preferred" };
      s.timeOfDay = { prefer: "morning", weight: 8 };
    })],
  ];

  it.each(sets)("%s: ranks exactly as if the hidden constraints were absent", (_, s) => {
    const p = build(s);
    const present = solveTop(BOTH, p);
    const absent = solveTop(BOTH, withoutHidden(p));
    expect(present.status).toBe("ok");
    expect(ranking(present)).toEqual(ranking(absent));
    expect(present.relaxed).toEqual(absent.relaxed);
    expect(present.schedules.map((x) => x.picks.map((pick) => pick.alternatives))).toEqual(
      absent.schedules.map((x) => x.picks.map((pick) => pick.alternatives)),
    );
    for (const schedule of present.schedules) {
      for (const name of ["campuses", "language", "avoidLecturers", "daysOff"]) {
        expect(schedule.breakdown.map((b) => b.item), name).not.toContain(name);
        expect(schedule.violations.map((v) => v.item), name).not.toContain(name);
      }
      expect(schedule.breakdown.find((b) => b.item === "compactDays")!.weight).toBe(0);
      expect(schedule.breakdown.find((b) => b.item === "noCampusSwitch")!.weight).toBe(0);
    }
  });

  it("the values are safe even if a mode were switched on by mistake: nothing is filtered and nothing relaxes (A3)", () => {
    for (const [name, s] of sets) {
      const p = build(s);
      const wrong = structuredClone(p);
      for (const hidden of ["campuses", "language", "avoidLecturers", "daysOff"] as const) wrong[hidden].mode = "required";
      const mistaken = solveTop(BOTH, wrong);
      const correct = solveTop(BOTH, p);
      expect(mistaken.status, name).toBe("ok");
      expect(mistaken.relaxed, name).toEqual([]);
      expect(ranking(mistaken), name).toEqual(ranking(correct));
    }
  });

  it("the EMPTY lists would not have been safe for campuses and language: this is why those two stay full (A3)", () => {
    const p = build(state());
    const wrong = structuredClone(p);
    wrong.campuses = { mode: "required", allowed: [] };
    wrong.language = { mode: "required", allowed: [] };
    expect(solveTop(BOTH, wrong).status).not.toBe("ok"); // every group is rejected
  });

  it("an empty avoidLecturers.names lets identical groups merge into alternatives; a non-empty one would stop that even when off (A3)", () => {
    // Two groups with the same time; one is taught by someone on a (hypothetical) avoid list.
    const course = syntheticCourse("ZZ0002", [
      { id: "L01", sessions: [[2, [2, 3]]] },
      { id: "L02", sessions: [[2, [2, 3]]], lecturer: "Nguyễn Văn A" },
    ]);
    const merged = solveTop(course, build(state()));
    expect(merged.schedules).toHaveLength(1);
    expect(merged.schedules[0].picks[0].alternatives).toHaveLength(1);

    const trap = build(state());
    trap.avoidLecturers = { mode: "off", names: ["Nguyễn Văn A"] };
    const notMerged = solveTop(course, trap);
    expect(notMerged.schedules).toHaveLength(2); // mode is "off", yet the two groups are no longer interchangeable
  });

  it("states the safe value of every hidden constraint, in the shape A3 gives", () => {
    const p = build(state());
    expect(p.campuses).toEqual({ mode: "off", allowed: [1, 2] });
    expect(p.language).toEqual({ mode: "off", allowed: ["V", "TA"] });
    expect(p.avoidLecturers).toEqual({ mode: "off", names: [] });
    expect(p.daysOff).toEqual({ mode: "off", days: [] });
    expect(p.maxNodes).toBe(5_000_000);
    expect(CONSTRAINTS.filter((name) => p[name].mode !== "off")).toEqual(["programs"]); // nothing else is on by default
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ui, translate } from "../src/i18n";
import { programOf, parse } from "../src/lib/parser";
import { solve, type SolveResult } from "../src/lib/solver";
import { buildMasks, type IndexedCourse } from "../src/lib/timing";
import {
  breaksProgram,
  buildPreferences,
  buildResultsView,
  buildSolveInput,
  emptyChoices,
  initialPreferencesState,
  restrictToProgram,
  toggleExclude,
  toggleLock,
  type CourseChoices,
  type PreferencesState,
  type ResultsView,
} from "../src/model";

// ---------------------------------------------------------------------------
// The rule (docs/ui-change-analysis.md A4, generalised): the app never shows a
// schedule the student cannot register for, i.e. one with a group of another
// program, whatever made the solver relax.
//
// Found on real data: program TN with CO2003, CO2007 and CO2011. Each course
// has a TN group, so `course-no-program` never fires; but the TN groups clash,
// the solver relaxes every required item, and all its options use a group of
// another program.
// ---------------------------------------------------------------------------

function indexed(names: string[]): IndexedCourse[] {
  return buildMasks(names.flatMap((n) => parse(readFileSync(new URL(`./fixtures/${n}.txt`, import.meta.url), "utf8")).courses)).courses;
}

const TN_CASE = indexed(["CO2003", "CO2007", "CO2011"]);

function state(program: string, edit?: (s: PreferencesState) => void): PreferencesState {
  const s = initialPreferencesState(program);
  edit?.(s);
  return s;
}

/** What the app does: build the request with the model, solve, build the view. */
function appRun(courses: IndexedCourse[], s: PreferencesState, choices: CourseChoices = emptyChoices()) {
  const input = buildSolveInput(courses, choices, s)!;
  const result = solve(input.courses, input.prefs);
  return { input, result, view: buildResultsView(result, input.courses) };
}

/** Every group id shown anywhere in a view, with its course. */
function shownGroups(view: ResultsView): { course: string; id: string }[] {
  if (view.kind !== "schedules") return [];
  return view.options.flatMap((o) => o.entries.flatMap((e) => [e.groupId, ...e.alternatives].map((id) => ({ course: e.courseCode, id }))));
}

const programOfId = (id: string) => programOf({ theoryGroup: id.split("_")[0] });

describe("the real case: program TN with CO2003, CO2007 and CO2011", () => {
  it("is what the solver does on its own: it relaxes the program and every option uses another program's group", () => {
    // The raw library behaviour that the rule guards against, pinned so the test below means something.
    const raw = solve(TN_CASE, buildPreferences(state("TN"), { locked: {}, excluded: [] })!);
    expect(raw.status).toBe("relaxed");
    expect(raw.relaxed).toContain("programs");
    expect(raw.diagnosticDetails.map((d) => d.code)).toEqual(["no-combination-required", "relaxed"]); // no course-no-program
    expect(raw.schedules.length).toBeGreaterThan(0);
    expect(raw.schedules.every(breaksProgram)).toBe(true);
  });

  it("the view never shows those options: with none left, it is the infeasible screen, and it says why", () => {
    const raw = solve(TN_CASE, buildPreferences(state("TN"), { locked: {}, excluded: [] })!);
    const view = buildResultsView(raw, TN_CASE);
    expect(view.kind).toBe("infeasible");
    if (view.kind !== "infeasible") return;
    expect(view.outsideProgram).toBe(true);
    // "relaxed" speaks of "the options below"; there are none, so it is not listed.
    expect(view.diagnostics.map((d) => d.code)).toEqual(["no-combination-required"]);
    expect(ui("results.outsideProgram", {}, "vi")).toContain("chương trình đào tạo của bạn");
    expect(ui("results.outsideProgram", {}, "en")).toContain("your study program");
  });

  it("through the app's own path, the solver is never offered the other programs' groups, and reports the clash itself", () => {
    const { input, result, view } = appRun(TN_CASE, state("TN"));
    expect(input.courses.map((c) => c.groups.map((g) => g.group.id))).toEqual([["TN01_TN01"], ["TN01_TN01"], ["TN01"]]);
    expect(result.status).toBe("infeasible");
    expect(result.schedules).toEqual([]);
    expect(view.kind).toBe("infeasible");
    if (view.kind !== "infeasible") return;
    expect(view.outsideProgram).toBe(false); // nothing had to be hidden: nothing out of program was ever found
    // The message names what happened: the groups of the student's own program cannot be combined.
    expect(view.diagnostics.map((d) => d.code)).toEqual(["no-combination-required", "no-combination"]);
    expect(translate("solver", view.diagnostics[0], "vi")).toBe(
      "Các lớp thuộc chương trình đào tạo của bạn không ghép được thành lịch nào mà không trùng giờ. Hãy bỏ bớt một môn.",
    );
    expect(translate("solver", view.diagnostics[0], "en")).toBe(
      "The groups in your study program cannot be combined into any schedule without time clashes. Try dropping a course.",
    );
  });

  it("dropping one of the clashing courses gives schedules, all inside TN", () => {
    const { view } = appRun(TN_CASE, state("TN"), { ...emptyChoices(), dropped: ["CO2003"] });
    expect(view.kind).toBe("schedules");
    expect(shownGroups(view).length).toBeGreaterThan(0);
    for (const g of shownGroups(view)) expect(programOfId(g.id), `${g.course} ${g.id}`).toBe("TN");
  });
});

describe("no false 'no schedule': an in-program schedule is found even when the solver's top K would all leave the program", () => {
  // CO2001's only L group is full. With "Còn chỗ trống: Bắt buộc" the solver relaxes everything,
  // and its ten best options all take a non-L group of CO2001. Filtering those afterwards would
  // wrongly report "no schedule"; the full L group IS a schedule the student can register for.
  const COURSES = indexed(["CO2001", "CO2007"]);
  const seatsRequired = (s: PreferencesState) => { s.freeSeats = { mode: "required" }; s.topK = 10; };

  it("the solver alone returns only out-of-program options here", () => {
    const raw = solve(COURSES, buildPreferences(state("L", seatsRequired), { locked: {}, excluded: [] })!);
    expect(raw.status).toBe("relaxed");
    expect(raw.schedules).toHaveLength(10);
    expect(raw.schedules.every(breaksProgram)).toBe(true);
  });

  it("the app's path shows in-program options, marked as breaking 'Còn chỗ trống' only", () => {
    const { result, view } = appRun(COURSES, state("L", seatsRequired));
    expect(result.status).toBe("relaxed");
    expect(view.kind).toBe("schedules");
    if (view.kind !== "schedules") return;
    expect(view.relaxed).toBe(true);
    for (const g of shownGroups(view)) expect(programOfId(g.id), `${g.course} ${g.id}`).toBe("L");
    for (const option of view.options) {
      expect(option.chips.map((c) => c.item)).toEqual(["freeSeats"]);
      expect(option.entries.find((e) => e.courseCode === "CO2001")).toMatchObject({ groupId: "L01", full: true });
    }
  });
});

describe("the invariant, across programs and settings", () => {
  const ALL = indexed(["CO2001", "CO2003", "CO2007", "CO2011", "SK2001", "SP1031"]);
  const SETTINGS: [string, (s: PreferencesState) => void][] = [
    ["defaults", () => {}],
    ["seats required", (s) => { s.freeSeats = { mode: "required" }; }],
    ["seats required + mornings off", (s) => { s.freeSeats = { mode: "required" }; s.partsOff = { mode: "required", cells: [2, 3, 4, 5, 6].map((day) => ({ day: day as 2, part: "morning" as const })) }; }],
    ["whole week off, required", (s) => { s.partsOff = { mode: "required", cells: [2, 3, 4, 5, 6, 7, 8].flatMap((day) => [{ day: day as 2, part: "morning" as const }, { day: day as 2, part: "afternoon" as const }]) }; }],
  ];

  for (const program of ["L", "A", "CC", "TN"]) {
    for (const [name, edit] of SETTINGS) {
      it(`program ${program}, ${name}: nothing shown is outside the program`, () => {
        // Drop the courses the results screen would offer to drop, as the student would, until schedules or a dead end.
        let choices = emptyChoices();
        let view = appRun(ALL, state(program, edit), choices).view;
        for (let guard = 0; guard < 6 && view.kind === "noProgram"; guard++) {
          choices = { ...choices, dropped: [...choices.dropped, ...view.courses.map((c) => c.course)] };
          view = appRun(ALL, state(program, edit), choices).view;
        }
        expect(["schedules", "infeasible", "empty"]).toContain(view.kind);
        for (const g of shownGroups(view)) expect(programOfId(g.id), `${g.course} ${g.id}`).toBe(program);
        if (view.kind === "schedules") for (const o of view.options) expect(o.chips.map((c) => c.item)).not.toContain("programs");
      });
    }
  }
});

describe("restrictToProgram", () => {
  const COURSES = indexed(["CO2007", "SK2001"]); // SK2001 has no L group
  const none = { locked: {}, excluded: [] };

  it("keeps only the program's groups of a course that has some, and leaves a course that has none untouched", () => {
    const [co2007, sk2001] = restrictToProgram(COURSES, "L", none);
    expect(co2007.groups.length).toBeGreaterThan(0);
    expect(co2007.groups.every((g) => programOf(g.group) === "L")).toBe(true);
    expect(sk2001).toBe(COURSES[1]); // untouched: solve reports course-no-program, and the screen offers to drop it
    expect(appRun(COURSES, state("L")).view).toEqual({ kind: "noProgram", courses: [{ course: "SK2001", allowed: ["L"], available: ["A", "CC"] }] });
  });

  it("does not change a run that needs no relaxing", () => {
    const prefs = buildPreferences(state("CC"), none)!;
    const keys = (r: SolveResult) => r.schedules.map((s) => ({ picks: s.picks.map((p) => [p.group.key, ...p.alternatives]), penalty: s.penalty }));
    const plain = solve(COURSES, prefs);
    expect(plain.status).toBe("ok");
    expect(keys(solve(restrictToProgram(COURSES, "CC", none), prefs))).toEqual(keys(plain));
  });

  it("leaves a course untouched when the student excluded every group of their own program: A4's message still applies", () => {
    let choices = emptyChoices();
    for (const g of COURSES[0].groups.filter((g) => programOf(g.group) === "L")) choices = toggleExclude(choices, "CO2007", g.group.id);
    const { input, view } = appRun([COURSES[0]], state("L"), choices);
    expect(input.courses[0].groups).toHaveLength(COURSES[0].groups.length);
    expect(view.kind).toBe("noProgram");
  });

  it("leaves a course untouched when the locked group is of another program", () => {
    const cc = COURSES[0].groups.find((g) => programOf(g.group) === "CC")!;
    const { input, view } = appRun([COURSES[0]], state("L"), toggleLock(emptyChoices(), "CO2007", cc.group.id));
    expect(input.courses[0].groups).toHaveLength(COURSES[0].groups.length);
    expect(view.kind).toBe("noProgram"); // never a schedule with that CC group
  });

  it("never mutates the pasted courses", () => {
    const before = COURSES.map((c) => c.groups.length);
    restrictToProgram(COURSES, "L", none);
    expect(COURSES.map((c) => c.groups.length)).toEqual(before);
  });
});

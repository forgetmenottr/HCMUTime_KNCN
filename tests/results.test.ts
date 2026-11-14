import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/lib/parser";
import { solve, type SolveResult } from "../src/lib/solver";
import { buildMasks, type IndexedCourse } from "../src/lib/timing";
import {
  buildPreferences,
  buildResultsView,
  clampWeek,
  emptyChoices,
  firstWeek,
  gridFor,
  groupChoicesFor,
  initialPreferencesState,
  neighbourWeek,
  toggleExclude,
  type CourseChoices,
  type OptionView,
  type PreferencesState,
  type ResultsView,
} from "../src/model";

// ---------------------------------------------------------------------------
// Fixtures and helpers: everything goes through the real parse → buildMasks → solve.
// ---------------------------------------------------------------------------

function indexed(names: string[]): IndexedCourse[] {
  const courses = names.flatMap((name) => parse(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8")).courses);
  return buildMasks(courses).courses;
}

const FOUR_CO = indexed(["CO2001", "CO2003", "CO2007", "CO2011"]);

function run(
  courses: IndexedCourse[],
  program: string,
  edit?: (s: PreferencesState) => void,
  choices: CourseChoices = emptyChoices(),
): SolveResult {
  const state = initialPreferencesState(program);
  edit?.(state);
  return solve(courses, buildPreferences(state, groupChoicesFor(courses, choices))!);
}

type SchedulesView = Extract<ResultsView, { kind: "schedules" }>;
function schedules(view: ResultsView): SchedulesView {
  expect(view.kind).toBe("schedules");
  return view as SchedulesView;
}

// ---------------------------------------------------------------------------

describe("the states of the results screen", () => {
  it("empty input is its own state, although solve answers status ok (G11)", () => {
    const result = run([], "L");
    expect(result.status).toBe("ok");
    expect(buildResultsView(result, [])).toEqual({ kind: "empty" });
  });

  it("an ordinary run gives tabs in the order returned, the first one marked best", () => {
    const result = run(FOUR_CO, "L");
    const view = schedules(buildResultsView(result, FOUR_CO));
    expect(view.relaxed).toBe(false);
    expect(view.truncated).toBe(false);
    expect(view.options.map((o) => o.n)).toEqual(result.schedules.map((_, i) => i + 1));
    expect(view.options.map((o) => o.best)).toEqual(result.schedules.map((_, i) => i === 0));
    // The register list is the picks, in input course order.
    expect(view.options[0].entries.map((e) => e.courseCode)).toEqual(FOUR_CO.map((c) => c.code));
    expect(view.options[0].entries.map((e) => e.groupId)).toEqual(result.schedules[0].picks.map((p) => p.group.group.id));
  });

  it("course-no-program is separated out: no schedules are shown, and the course is offered for dropping (A4)", () => {
    const courses = indexed(["CO2007", "SK2001"]); // SK2001 has no L group
    const result = run(courses, "L");
    expect(result.status).toBe("relaxed");
    expect(result.schedules.length).toBeGreaterThan(0); // the solver did find relaxed schedules …
    const view = buildResultsView(result, courses);
    expect(view).toEqual({ kind: "noProgram", courses: [{ course: "SK2001", allowed: ["L"], available: ["A", "CC"] }] }); // … which the view withholds
  });

  it("a relaxed run without course-no-program shows its schedules with the banner and chips as codes", () => {
    // CO2001's only L group is full (120/120), so "Còn chỗ trống: Bắt buộc" cannot be met.
    const result = run(FOUR_CO, "L", (s) => { s.freeSeats = { mode: "required" }; });
    expect(result.status).toBe("relaxed");
    const view = schedules(buildResultsView(result, FOUR_CO));
    expect(view.relaxed).toBe(true);
    expect(view.diagnostics.map((d) => d.code)).toContain("relaxed");
    const first = view.options[0];
    const chip = first.chips.find((c) => c.item === "freeSeats")!;
    expect(chip.courses).toContain("CO2001"); // a code and an array, not a sentence
    expect(first.entries.find((e) => e.courseCode === "CO2001")!.full).toBe(true);
    expect(first.sessions.filter((s) => s.courseCode === "CO2001").every((s) => s.violating)).toBe(true);
    expect(first.sessions.some((s) => !s.violating)).toBe(true);
  });

  it("no schedule at all is infeasible, with the diagnostics kept as codes", () => {
    let choices = emptyChoices();
    for (const g of FOUR_CO[0].groups) choices = toggleExclude(choices, FOUR_CO[0].code, g.group.id);
    const view = buildResultsView(run(FOUR_CO, "L", undefined, choices), FOUR_CO);
    expect(view.kind).toBe("infeasible");
    if (view.kind === "infeasible") expect(view.diagnostics.map((d) => d.code)).toEqual(["all-excluded"]);
  });

  it("surfaces stats.truncated itself, because no diagnostic carries it when schedules were found (G10)", () => {
    const result = run(FOUR_CO, "L");
    const cut: SolveResult = { ...result, stats: { ...result.stats, truncated: true } };
    expect(cut.diagnosticDetails).toEqual([]);
    expect(schedules(buildResultsView(cut, FOUR_CO)).truncated).toBe(true);
  });
});

describe("ties", () => {
  it("marks a tab whose penalty equals the previous tab's, and only that one", () => {
    const result = run(FOUR_CO, "L");
    expect(result.schedules.length).toBeGreaterThanOrEqual(4);
    const penalties = [1, 1, 2, 2 + 1e-12, 3];
    const tampered: SolveResult = { ...result, schedules: result.schedules.slice(0, 5).map((s, i) => ({ ...s, penalty: penalties[i] })) };
    const view = schedules(buildResultsView(tampered, FOUR_CO));
    expect(view.options.map((o) => o.tie)).toEqual([false, true, false, true, false].slice(0, view.options.length));
    expect(view.options[0].best).toBe(true);
  });

  it("agrees with the real penalties", () => {
    const result = run(FOUR_CO, "L", (s) => { s.topK = 10; });
    const view = schedules(buildResultsView(result, FOUR_CO));
    view.options.forEach((o, i) => {
      expect(o.tie).toBe(i > 0 && Math.abs(result.schedules[i].penalty - result.schedules[i - 1].penalty) < 1e-9);
    });
  });
});

describe("alternatives (G12)", () => {
  it("resolves keys to group ids of the same course", () => {
    const courses = indexed(["SK2001"]); // 60 CC groups, many at identical times
    const result = run(courses, "CC");
    const view = schedules(buildResultsView(result, courses));
    const entry = view.options[0].entries[0];
    expect(result.schedules[0].picks[0].alternatives.length).toBeGreaterThan(0);
    expect(entry.alternatives).toHaveLength(result.schedules[0].picks[0].alternatives.length);
    const ids = new Set(courses[0].groups.map((g) => g.group.id));
    for (const id of entry.alternatives) {
      expect(id).not.toContain(":");
      expect(ids.has(id)).toBe(true);
    }
  });

  it("still shows the id part of a key it cannot find", () => {
    const result = run(FOUR_CO, "L");
    const odd: SolveResult = structuredClone(result);
    odd.schedules[0].picks[0].alternatives = ["CO2001:Z99"];
    expect(schedules(buildResultsView(odd, FOUR_CO)).options[0].entries[0].alternatives).toEqual(["Z99"]);
  });
});

describe("the grid", () => {
  const view = schedules(buildResultsView(run(FOUR_CO, "L"), FOUR_CO));

  it("has rows 1–12 when no picked session is later (true of every fixture)", () => {
    for (const option of view.options) expect(option.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("adds rows 13–16 only when a picked session uses them", () => {
    const result = run(FOUR_CO, "L");
    // Schedules share group objects, so only option 1's copy is changed.
    const pick = structuredClone(result.schedules[0].picks[0]);
    pick.group.group.sessions[0].periods = [13, 14];
    result.schedules[0] = { ...result.schedules[0], picks: [pick, ...result.schedules[0].picks.slice(1)] };
    const late = schedules(buildResultsView(result, FOUR_CO));
    expect(late.options[0].rows).toHaveLength(16);
    expect(late.options[1].rows).toHaveLength(12);
    expect(gridFor(late.options[0], null).blocks.some((b) => b.from === 13 && b.to === 14)).toBe(true);
  });

  it("all-weeks view: two alternating-week lab groups share one block, marked alternating (real data, program L)", () => {
    const shared = view.options.flatMap((o) => gridFor(o, null).blocks.filter((b) => b.alternating));
    expect(shared.length).toBeGreaterThan(0); // data-contract §5: 2 of the top 5
    for (const block of shared) {
      expect(block.entries.length).toBeGreaterThan(1);
      // Not a clash: no week is shared by two entries of the block.
      const weeks = block.entries.flatMap((e) => e.weeks);
      expect(new Set(weeks).size).toBe(weeks.length);
    }
  });

  it("week view: no block is ever shared, in any week of any option", () => {
    for (const option of view.options) {
      for (const week of option.weeks) {
        const grid = gridFor(option, week);
        expect(grid.blocks.every((b) => !b.alternating && b.entries.length === 1)).toBe(true);
        expect(grid.blocks.length).toBeGreaterThan(0); // only weeks that have a session are listed
      }
    }
  });

  it("week view shows exactly the sessions that meet in that week", () => {
    const option = view.options[0];
    for (const week of option.weeks) {
      const expected = option.sessions.filter((s) => s.weeks.includes(week)).length;
      expect(gridFor(option, week).blocks.length).toBe(expected);
    }
  });

  it("blocks never overlap within a day, and active days are the days that have one", () => {
    for (const option of view.options) {
      const grid = gridFor(option, null);
      const sorted = [...grid.blocks].sort((a, b) => a.day - b.day || a.from - b.from);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].day === sorted[i - 1].day) expect(sorted[i].from).toBeGreaterThan(sorted[i - 1].to);
      }
      expect([...grid.activeDays].sort()).toEqual([...new Set(option.sessions.map((s) => s.day))].sort());
    }
  });

  it("splits a session with a gap in its periods into two blocks", () => {
    const option: OptionView = {
      ...view.options[0],
      sessions: [{ courseCode: "X", groupId: "L01", day: 2, periods: [2, 3, 8, 9], weeks: [1], kind: "theory", violating: false }],
    };
    expect(gridFor(option, null).blocks.map((b) => [b.from, b.to])).toEqual([[2, 3], [8, 9]]);
  });
});

describe("the week selector", () => {
  const option = schedules(buildResultsView(run(FOUR_CO, "L"), FOUR_CO)).options[0];

  it("lists the weeks of the picked sessions, ascending, and opens on the first", () => {
    expect(option.weeks).toEqual([...new Set(option.sessions.flatMap((s) => s.weeks))].sort((a, b) => a - b));
    expect(firstWeek(option)).toBe(option.weeks[0]);
  });

  it("‹ › move to the neighbouring listed week and stop at the ends; weeks with no session are skipped", () => {
    const [first, second] = option.weeks;
    const last = option.weeks[option.weeks.length - 1];
    expect(neighbourWeek(option, first, 1)).toBe(second);
    expect(neighbourWeek(option, second, -1)).toBe(first);
    expect(neighbourWeek(option, first, -1)).toBeNull();
    expect(neighbourWeek(option, last, 1)).toBeNull();
    const gappy: OptionView = { ...option, weeks: [1, 2, 9] }; // week 8 is the break in the fixtures
    expect(neighbourWeek(gappy, 2, 1)).toBe(9);
    expect(neighbourWeek(gappy, 9, -1)).toBe(2);
  });

  it("keeps the week across tabs when it exists there, else takes the nearest", () => {
    const other: OptionView = { ...option, weeks: [2, 4, 10] };
    expect(clampWeek(other, 4)).toBe(4);
    expect(clampWeek(other, 9)).toBe(10);
    expect(clampWeek(other, null)).toBe(2);
    expect(clampWeek({ ...option, weeks: [] }, 3)).toBeNull();
  });
});

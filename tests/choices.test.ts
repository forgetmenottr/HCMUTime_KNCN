import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/lib/parser";
import { solve } from "../src/lib/solver";
import { buildMasks, type IndexedCourse } from "../src/lib/timing";
import {
  FIRST_CHOICE_WEIGHT,
  buildPreferences,
  creditTotals,
  dropCourse,
  emptyChoices,
  groupChoicesFor,
  includedCourses,
  initialPreferencesState,
  isExcluded,
  isIncluded,
  isLocked,
  programOptions,
  setTimeOfDay,
  toggleCourse,
  toggleExclude,
  toggleLock,
} from "../src/model";

function indexed(names: string[]): IndexedCourse[] {
  return buildMasks(names.flatMap((name) => parse(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8")).courses)).courses;
}

const COURSES = indexed(["CO2007", "CO2011"]);
const [A, B] = COURSES[0].groups.map((g) => g.group.id);

describe("step-2 choices", () => {
  it("every course is included until its box is unticked", () => {
    let c = emptyChoices();
    expect(includedCourses(COURSES, c).map((x) => x.code)).toEqual(["CO2007", "CO2011"]);
    c = toggleCourse(c, "CO2007");
    expect(isIncluded(c, "CO2007")).toBe(false);
    expect(includedCourses(COURSES, c).map((x) => x.code)).toEqual(["CO2011"]);
    expect(dropCourse(c, "CO2007")).toBe(c); // already left out
    expect(toggleCourse(c, "CO2007").dropped).toEqual([]);
  });

  it("one locked group per course; clicking the locked one unlocks it", () => {
    let c = toggleLock(emptyChoices(), "CO2007", A);
    c = toggleLock(c, "CO2007", B);
    expect(c.locked).toEqual({ CO2007: B });
    expect(isLocked(c, "CO2007", A)).toBe(false);
    expect(toggleLock(c, "CO2007", B).locked).toEqual({});
  });

  it("a group is never both locked and excluded: the later click wins", () => {
    let c = toggleExclude(emptyChoices(), "CO2007", A);
    c = toggleLock(c, "CO2007", A);
    expect(isExcluded(c, "CO2007", A)).toBe(false);
    expect(isLocked(c, "CO2007", A)).toBe(true);
    c = toggleExclude(c, "CO2007", A);
    expect(isLocked(c, "CO2007", A)).toBe(false);
    expect(isExcluded(c, "CO2007", A)).toBe(true);
  });

  it("builds the payload in its two id formats (G16)", () => {
    let c = toggleLock(emptyChoices(), "CO2007", A);
    c = toggleExclude(c, "CO2011", COURSES[1].groups[0].group.id);
    expect(groupChoicesFor(COURSES, c)).toEqual({
      locked: { CO2007: A }, // bare id
      excluded: [`CO2011:${COURSES[1].groups[0].group.id}`], // full key
    });
  });

  it("leaves out choices that no longer match the pasted data, so a stale lock cannot make the solve infeasible", () => {
    const stale = { dropped: ["XX0000"], locked: { CO2007: "Z99", MT1003: "L01" }, excluded: ["CO2011:Z99", "MT1003:L01"] as const };
    const choices = groupChoicesFor(COURSES, { ...stale, excluded: [...stale.excluded] });
    expect(choices).toEqual({ locked: {}, excluded: [] });
    const result = solve(COURSES, buildPreferences(initialPreferencesState("L"), choices)!);
    expect(result.status).toBe("ok");
  });

  it("drops the choices of a course that is left out", () => {
    let c = toggleLock(emptyChoices(), "CO2007", A);
    c = toggleCourse(c, "CO2007");
    expect(groupChoicesFor(COURSES, c)).toEqual({ locked: {}, excluded: [] });
    expect(c.locked).toEqual({ CO2007: A }); // kept in the state, so re-ticking the box restores it
  });
});

describe("credit counter", () => {
  it("sums included courses and counts the ones with unknown credits", () => {
    const courses = [
      { code: "A", credits: 4 },
      { code: "B", credits: null },
      { code: "C", credits: 3 },
    ];
    expect(creditTotals(courses, emptyChoices())).toEqual({ credits: 7, unknown: 1 });
    expect(creditTotals(courses, toggleCourse(toggleCourse(emptyChoices(), "B"), "C"))).toEqual({ credits: 4, unknown: 0 });
  });
});

describe("program options", () => {
  it("always lists L, A, CC, TN, and marks the ones absent from the data", () => {
    const options = programOptions(indexed(["SK2001"])); // only A and CC
    expect(options.map((o) => o.code)).toEqual(["L", "A", "CC", "TN"]);
    expect(options.map((o) => o.present)).toEqual([false, true, true, false]);
    expect(options.every((o) => o.known)).toBe(true);
  });

  it("adds an unknown prefix after the four, as present and not known", () => {
    const odd = structuredClone(COURSES);
    odd[0].groups[0].group.theoryGroup = "XYZ01";
    expect(programOptions(odd).slice(4)).toEqual([{ code: "XYZ", known: false, present: true }]);
  });
});

describe("the time-of-day choice (B5)", () => {
  const fresh = () => initialPreferencesState("L");

  it("leaving Không with the slider at 0 sets it to 5", () => {
    expect(FIRST_CHOICE_WEIGHT).toBe(5);
    expect(setTimeOfDay(fresh(), "morning").timeOfDay).toEqual({ prefer: "morning", weight: 5 });
  });

  it("does not touch a slider the student already moved", () => {
    const s = { ...fresh(), timeOfDay: { prefer: "none" as const, weight: 8 } };
    expect(setTimeOfDay(s, "afternoon").timeOfDay).toEqual({ prefer: "afternoon", weight: 8 });
  });

  it("switching between Sáng and Chiều at 0 leaves 0: the student set it", () => {
    const s = { ...fresh(), timeOfDay: { prefer: "morning" as const, weight: 0 } };
    expect(setTimeOfDay(s, "afternoon").timeOfDay).toEqual({ prefer: "afternoon", weight: 0 });
  });

  it("going back to Không keeps the value, so choosing again restores it", () => {
    const s = setTimeOfDay({ ...setTimeOfDay(fresh(), "morning"), timeOfDay: { prefer: "morning", weight: 9 } }, "none");
    expect(s.timeOfDay).toEqual({ prefer: "none", weight: 9 });
    expect(buildPreferences(s, { locked: {}, excluded: [] })!.weights.timeOfDay).toEqual({ prefer: "none", weight: 0 });
    expect(setTimeOfDay(s, "morning").timeOfDay.weight).toBe(9);
  });
});

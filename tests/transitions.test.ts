import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/lib/parser";
import { solve } from "../src/lib/solver";
import { buildMasks } from "../src/lib/timing";
import {
  FIRST_TICK_MODE,
  buildPreferences,
  dayState,
  effectiveMode,
  initialPreferencesState,
  toggleCell,
  toggleWholeDay,
  type GridCell,
  type GroupChoices,
  type PreferencesState,
} from "../src/model";

const NO_CHOICES: GroupChoices = { locked: {}, excluded: [] };
const fresh = (): PreferencesState => initialPreferencesState("L");
const MON_MORNING: GridCell = { day: 2, part: "morning" };
const MON_AFTERNOON: GridCell = { day: 2, part: "afternoon" };
const TUE_MORNING: GridCell = { day: 3, part: "morning" };

describe("the first tick on an empty grid", () => {
  it("switches mode Tắt to Bắt buộc, and the builder then sends the cell as required", () => {
    expect(FIRST_TICK_MODE).toBe("required");
    const s = toggleCell(fresh(), MON_MORNING);
    expect(s.partsOff).toEqual({ mode: "required", cells: [MON_MORNING] });
    expect(buildPreferences(s, NO_CHOICES)!.partsOff).toEqual({ mode: "required", parts: [MON_MORNING] });
  });

  it("makes the tick matter: on the real fixtures, no pick meets in Monday's morning afterwards", () => {
    const courses = buildMasks(
      ["CO2007", "CO2011"].flatMap((name) => parse(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8")).courses),
    ).courses;
    const p = buildPreferences(toggleCell(fresh(), MON_MORNING), NO_CHOICES)!;
    const result = solve(courses, { ...p, topK: 10 });
    expect(result.status).toBe("ok");
    expect(result.schedules.length).toBeGreaterThan(0);
    for (const schedule of result.schedules) {
      for (const pick of schedule.picks) {
        const clash = pick.group.group.sessions.some((s) => s.day === 2 && s.periods.some((n) => n >= 1 && n <= 6));
        expect(clash, pick.group.key).toBe(false);
      }
    }
    // Without the transition the same tick would have done nothing: mode stays Tắt.
    const untouched = { ...fresh(), partsOff: { mode: "off" as const, cells: [MON_MORNING] } };
    expect(buildPreferences(untouched, NO_CHOICES)!.partsOff.mode).toBe("off");
  });

  it("counts a whole-day tick on an empty grid as the first tick too", () => {
    expect(toggleWholeDay(fresh(), 2).partsOff).toEqual({ mode: "required", cells: [MON_MORNING, MON_AFTERNOON] });
  });

  it("only replaces Tắt: a mode the student had chosen is kept", () => {
    for (const mode of ["preferred", "required"] as const) {
      const chosen = { ...fresh(), partsOff: { mode, cells: [] } };
      expect(toggleCell(chosen, MON_MORNING).partsOff.mode, mode).toBe(mode);
    }
    // Switch off and stored "preferred": the "Đang tạm tắt" note explains, so Ưu tiên is not overwritten.
    const paused = { ...fresh(), preferredSwitch: false, partsOff: { mode: "preferred" as const, cells: [] } };
    const after = toggleCell(paused, MON_MORNING);
    expect(after.partsOff.mode).toBe("preferred");
    expect(effectiveMode(after, "partsOff")).toBe("off");
  });

  it("happens only for the FIRST tick: later ticks leave the mode alone", () => {
    const first = toggleCell(fresh(), MON_MORNING);
    const chosen: PreferencesState = { ...first, partsOff: { ...first.partsOff, mode: "preferred" } };
    expect(toggleCell(chosen, TUE_MORNING).partsOff.mode).toBe("preferred");
    const turnedOff: PreferencesState = { ...first, partsOff: { ...first.partsOff, mode: "off" } };
    expect(toggleCell(turnedOff, TUE_MORNING).partsOff.mode).toBe("off"); // the grid was not empty, so no switch
  });

  it("does not switch the mode back when the last cell is unticked: the stored mode stays", () => {
    const ticked = toggleCell(fresh(), MON_MORNING);
    const cleared = toggleCell(ticked, MON_MORNING);
    expect(cleared.partsOff).toEqual({ mode: "required", cells: [] });
    expect(effectiveMode(cleared, "partsOff")).toBe("off"); // an empty grid sends off (B8, rule 2)
    expect(buildPreferences(cleared, NO_CHOICES)!.partsOff).toEqual({ mode: "off", parts: [] });
    expect(toggleCell(cleared, TUE_MORNING).partsOff.mode).toBe("required");
  });

  it("switches again if the student had set Tắt and then emptied the grid", () => {
    const ticked = toggleCell(fresh(), MON_MORNING);
    const off: PreferencesState = { ...ticked, partsOff: { ...ticked.partsOff, mode: "off" } };
    const emptied = toggleCell(off, MON_MORNING);
    expect(emptied.partsOff.mode).toBe("off");
    expect(toggleCell(emptied, MON_MORNING).partsOff.mode).toBe("required");
  });
});

describe("toggleCell", () => {
  it("ticks, then unticks, a cell", () => {
    const ticked = toggleCell(fresh(), TUE_MORNING);
    expect(ticked.partsOff.cells).toEqual([TUE_MORNING]);
    expect(toggleCell(ticked, TUE_MORNING).partsOff.cells).toEqual([]);
  });

  it("keeps the cells in one fixed order whatever order they were ticked in", () => {
    let s = fresh();
    for (const cell of [{ day: 8, part: "afternoon" }, MON_AFTERNOON, { day: 6, part: "morning" }, MON_MORNING] as GridCell[]) {
      s = toggleCell(s, cell);
    }
    expect(s.partsOff.cells).toEqual([
      MON_MORNING,
      MON_AFTERNOON,
      { day: 6, part: "morning" },
      { day: 8, part: "afternoon" },
    ]);
  });

  it("changes nothing for a cell the grid does not have (evening, or a day that does not exist)", () => {
    const s = fresh();
    expect(toggleCell(s, { day: 2, part: "evening" } as unknown as GridCell)).toBe(s);
    expect(toggleCell(s, { day: 9, part: "morning" } as unknown as GridCell)).toBe(s);
  });

  it("returns a new state and never mutates its input", () => {
    const s = toggleCell(fresh(), MON_MORNING);
    const snapshot = structuredClone(s);
    const next = toggleCell(s, TUE_MORNING);
    expect(s).toEqual(snapshot);
    expect(next).not.toBe(s);
    expect(next.partsOff.cells).not.toBe(s.partsOff.cells);
  });

  it("touches nothing but partsOff", () => {
    const s: PreferencesState = { ...fresh(), freeSeats: { mode: "required" }, topK: 8, timeOfDay: { prefer: "morning", weight: 3 } };
    const next = toggleCell(s, MON_MORNING);
    const { partsOff: _before, ...restBefore } = s;
    const { partsOff: _after, ...restAfter } = next;
    expect(restAfter).toEqual(restBefore);
  });
});

describe("toggleWholeDay and the Cả ngày cell (B2)", () => {
  it("none → both ticked → none", () => {
    const s0 = fresh();
    expect(dayState(s0.partsOff.cells, 2)).toBe("none");
    const s1 = toggleWholeDay(s0, 2);
    expect(dayState(s1.partsOff.cells, 2)).toBe("all");
    const s2 = toggleWholeDay(s1, 2);
    expect(dayState(s2.partsOff.cells, 2)).toBe("none");
    expect(s2.partsOff.cells).toEqual([]);
  });

  it("with only one cell ticked (partial), a click ticks both", () => {
    for (const cell of [MON_MORNING, MON_AFTERNOON]) {
      const partial = toggleCell(fresh(), cell);
      expect(dayState(partial.partsOff.cells, 2)).toBe("partial");
      expect(toggleWholeDay(partial, 2).partsOff.cells).toEqual([MON_MORNING, MON_AFTERNOON]);
    }
  });

  it("unticking one cell of a ticked day makes it partial", () => {
    const all = toggleWholeDay(fresh(), 2);
    expect(dayState(toggleCell(all, MON_AFTERNOON).partsOff.cells, 2)).toBe("partial");
  });

  it("leaves other days alone", () => {
    const s = toggleWholeDay(toggleCell(fresh(), TUE_MORNING), 2);
    expect(s.partsOff.cells).toEqual([MON_MORNING, MON_AFTERNOON, TUE_MORNING]);
    expect(toggleWholeDay(s, 2).partsOff.cells).toEqual([TUE_MORNING]);
  });

  it("stores no evening cell: the builder derives the evening part from the two ticked cells", () => {
    const s = toggleWholeDay(fresh(), 2);
    expect(s.partsOff.cells.map((c) => c.part)).toEqual(["morning", "afternoon"]);
    expect(buildPreferences(s, NO_CHOICES)!.partsOff.parts).toEqual([MON_MORNING, MON_AFTERNOON, { day: 2, part: "evening" }]);
    expect(buildPreferences(toggleCell(s, MON_AFTERNOON), NO_CHOICES)!.partsOff.parts).toEqual([MON_MORNING]);
  });

  it("ignores a day that is not on the grid", () => {
    const s = fresh();
    expect(toggleWholeDay(s, 1 as never)).toBe(s);
    expect(toggleWholeDay(s, 9 as never)).toBe(s);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ui } from "../src/i18n";
import { parse } from "../src/lib/parser";
import { solve } from "../src/lib/solver";
import { buildMasks } from "../src/lib/timing";
import {
  PREFERRED_CONTROLS,
  buildPreferences,
  computeShares,
  initialPreferencesState,
  largestRemainder,
  type GridCell,
  type GroupChoices,
  type PreferencesState,
} from "../src/model";

const NO_CHOICES: GroupChoices = { locked: {}, excluded: [] };
const CELL: GridCell = { day: 2, part: "morning" };

/** A step-3 state with edits applied; the defaults are the B6 "mặc định" row: Không, 5, 3, switch on, nothing preferred. */
function state(edit?: (s: PreferencesState) => void): PreferencesState {
  const s = initialPreferencesState("L");
  edit?.(s);
  return s;
}

/** The three rows and the switch as `[time, fewer, early, switch]`, percent only. */
function percents(s: PreferencesState): (number | null)[] {
  const r = computeShares(s);
  return [r.timeOfDay.percent, r.fewerDays.percent, r.avoidEarly.percent, r.preferredItems.percent];
}

/** The B6 table states, built from the screen's own state. */
const MORNING_5 = (s: PreferencesState) => { s.timeOfDay = { prefer: "morning", weight: 5 }; };
const ONE_PREFERRED = (s: PreferencesState) => { s.partsOff = { mode: "preferred", cells: [CELL] }; };
const TWO_PREFERRED = (s: PreferencesState) => { ONE_PREFERRED(s); s.freeSeats = { mode: "preferred" }; };

describe("the worked examples of B6", () => {
  it("default (Không, 5, 3, nothing preferred): total 8, 63% / 37%", () => {
    const r = computeShares(state());
    expect(r.total).toBe(8);
    expect(percents(state())).toEqual([null, 63, 37, null]);
    expect(r.timeOfDay.disabled).toBe(true);
    expect(r.noWishes).toBe(false);
  });

  it("Sáng chosen, slider jumped to 5: total 13, 39% / 38% / 23%", () => {
    expect(computeShares(state(MORNING_5)).total).toBe(13);
    expect(percents(state(MORNING_5))).toEqual([39, 38, 23, null]);
  });

  it("time off set to Ưu tiên (n = 1): total 13, 39% / 23% / 38% on the switch", () => {
    const r = computeShares(state(ONE_PREFERRED));
    expect(r.total).toBe(13);
    expect(r.preferredItems.count).toBe(1);
    expect(percents(state(ONE_PREFERRED))).toEqual([null, 39, 23, 38]);
  });

  it("time off and free seats both Ưu tiên (n = 2, the maximum): total 18, 28% / 17% / 55%", () => {
    const r = computeShares(state(TWO_PREFERRED));
    expect(r.total).toBe(18);
    expect(r.preferredItems.count).toBe(2);
    expect(percents(state(TWO_PREFERRED))).toEqual([null, 28, 17, 55]);
  });

  it("the switch off: the same controls no longer count, so 63% / 37% and nothing beside the switch", () => {
    const s = state((x) => { TWO_PREFERRED(x); x.preferredSwitch = false; });
    expect(percents(s)).toEqual([null, 63, 37, null]);
    expect(computeShares(s).preferredItems).toEqual({ count: 0, percent: null });
  });

  it("the pre-merge case (n = 3, total 23) was 22% / 13% / 65%: the rounding still gives that, but n = 3 can no longer happen", () => {
    expect(largestRemainder([5, 3, 15])).toEqual([22, 13, 65]);
    expect(PREFERRED_CONTROLS).toHaveLength(2); // Ngày nghỉ and Buổi nghỉ are one control now (B2); only two remain
  });
});

describe("what counts as preferred", () => {
  it("uses the effective mode: a time-off grid with nothing ticked is not counted, even if stored as Ưu tiên", () => {
    const s = state((x) => { x.partsOff = { mode: "preferred", cells: [] }; x.freeSeats = { mode: "preferred" }; });
    expect(computeShares(s).preferredItems.count).toBe(1);
  });

  it("does not count Bắt buộc or Tắt", () => {
    const s = state((x) => { x.partsOff = { mode: "required", cells: [CELL] }; x.freeSeats = { mode: "off" }; });
    expect(computeShares(s).preferredItems).toEqual({ count: 0, percent: null });
    expect(computeShares(s).total).toBe(8);
  });

  it("counts a control stored as Ưu tiên again as soon as the switch is back on (nothing is lost)", () => {
    const paused = state((x) => { ONE_PREFERRED(x); x.preferredSwitch = false; });
    expect(computeShares(paused).preferredItems.count).toBe(0);
    expect(computeShares({ ...paused, preferredSwitch: true }).preferredItems.count).toBe(1);
  });
});

describe("what a row shows", () => {
  it("a disabled time-of-day row shows nothing (null), but keeps its slider value for aria-valuenow", () => {
    const r = computeShares(state((s) => { s.timeOfDay = { prefer: "none", weight: 7 }; }));
    expect(r.timeOfDay).toEqual({ value: 7, disabled: true, percent: null });
    expect(r.total).toBe(8); // the 7 is not in the total while the radio says Không
  });

  it("an enabled slider at 0 shows 0%, not a dash, once something else is set", () => {
    const r = computeShares(state((s) => { s.avoidEarly = 0; }));
    expect(r.avoidEarly).toEqual({ value: 0, disabled: false, percent: 0 });
    expect(r.fewerDays.percent).toBe(100);
  });

  it("clamps the raw value like the builder does", () => {
    const r = computeShares(state((s) => { s.fewerDays = 15; s.avoidEarly = -2; }));
    expect(r.fewerDays.value).toBe(10);
    expect(r.avoidEarly.value).toBe(0);
  });

  it("gives what the screen needs for aria-valuetext: B6's sentence, in both languages", () => {
    const r = computeShares(state());
    const { value, percent } = r.fewerDays;
    expect(ui("prefs.share.aria", { v: value, p: percent }, "vi")).toBe("mức 5 trên 10, chiếm 63%");
    expect(ui("prefs.share.aria", { v: value, p: percent }, "en")).toBe("level 5 out of 10, makes up 63%");
    const sw = computeShares(state(ONE_PREFERRED)).preferredItems;
    expect(ui("prefs.share.value", { p: sw.percent }, "vi")).toBe("chiếm 38%");
  });
});

describe("edge cases of B6", () => {
  it("everything at 0 and nothing preferred: every row is a dash and the 'no wishes' message applies", () => {
    const r = computeShares(state((s) => { s.fewerDays = 0; s.avoidEarly = 0; }));
    expect(r.total).toBe(0);
    expect(r.noWishes).toBe(true);
    expect(percents(state((s) => { s.fewerDays = 0; s.avoidEarly = 0; }))).toEqual([null, null, null, null]);
    expect(r.fewerDays.value).toBe(0); // the values are still there
  });

  it("a Không time of day with a weight does not make a wish", () => {
    const r = computeShares(state((s) => { s.fewerDays = 0; s.avoidEarly = 0; s.timeOfDay = { prefer: "none", weight: 9 }; }));
    expect(r.noWishes).toBe(true);
  });

  it("only one row above 0: that row is 100%, the other enabled rows 0%", () => {
    const s = state((x) => { x.fewerDays = 4; x.avoidEarly = 0; });
    expect(percents(s)).toEqual([null, 100, 0, null]);
    expect(percents(state((x) => { x.fewerDays = 0; x.avoidEarly = 0; x.timeOfDay = { prefer: "afternoon", weight: 1 }; }))).toEqual([100, 0, 0, null]);
  });

  it("a preferred control alone is 100% of the total", () => {
    const s = state((x) => { x.fewerDays = 0; x.avoidEarly = 0; ONE_PREFERRED(x); });
    expect(percents(s)).toEqual([null, 0, 0, 100]);
    expect(computeShares(s).noWishes).toBe(false);
  });

  it("all rows equal: the same shares at 1 as at 10, because only the ratios matter", () => {
    const equal = (n: number) => state((s) => { s.timeOfDay = { prefer: "morning", weight: n }; s.fewerDays = n; s.avoidEarly = n; });
    expect(percents(equal(1))).toEqual(percents(equal(10)));
    expect(percents(equal(5))).toEqual(percents(equal(10)));
    // Three equal rows cannot all show the same whole percent and still sum to 100: the spare point goes to the top row.
    expect(percents(equal(5))).toEqual([34, 33, 33, null]);
    // Two equal rows split evenly.
    expect(percents(state((s) => { s.fewerDays = 5; s.avoidEarly = 5; }))).toEqual([null, 50, 50, null]);
  });

  it("scaling every weight by the same factor leaves the shares unchanged", () => {
    const small = state((s) => { s.timeOfDay = { prefer: "morning", weight: 2 }; s.fewerDays = 1; s.avoidEarly = 1; });
    const big = state((s) => { s.timeOfDay = { prefer: "morning", weight: 10 }; s.fewerDays = 5; s.avoidEarly = 5; });
    expect(percents(small)).toEqual(percents(big));
  });
});

describe("largestRemainder", () => {
  it("sums to exactly 100 and stays within one point of the exact share, for every combination of the screen", () => {
    let checked = 0;
    for (const prefer of ["none", "morning"] as const) {
      for (let tod = 0; tod <= 10; tod++) {
        for (let fewer = 0; fewer <= 10; fewer++) {
          for (let early = 0; early <= 10; early++) {
            for (const n of [0, 1, 2]) {
              const s = state((x) => {
                x.timeOfDay = { prefer, weight: tod };
                x.fewerDays = fewer;
                x.avoidEarly = early;
                if (n >= 1) ONE_PREFERRED(x);
                if (n >= 2) x.freeSeats = { mode: "preferred" };
              });
              const r = computeShares(s);
              const shown = [r.timeOfDay.percent, r.fewerDays.percent, r.avoidEarly.percent, r.preferredItems.percent].filter((p): p is number => p !== null);
              if (r.noWishes) {
                expect(shown).toEqual([]);
                continue;
              }
              expect(shown.reduce((a, b) => a + b, 0)).toBe(100);
              const weights = [prefer === "none" ? 0 : tod, fewer, early, 5 * n];
              const exact = [r.timeOfDay.percent, r.fewerDays.percent, r.avoidEarly.percent, r.preferredItems.percent];
              weights.forEach((w, i) => {
                if (exact[i] !== null) expect(Math.abs(exact[i]! - (100 * w) / r.total)).toBeLessThan(1);
              });
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it("gives the leftover points to the largest remainders, and a tie to the row listed first", () => {
    expect(largestRemainder([5, 3])).toEqual([63, 37]); // 62.5 / 37.5: a tie, the first row rounds up
    expect(largestRemainder([3, 5])).toEqual([38, 62]); // the same tie, listed the other way round
    expect(largestRemainder([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainder([5, 5, 3])).toEqual([39, 38, 23]); // 38.46 / 38.46 / 23.08: the tie goes to the upper row
    expect(largestRemainder([3, 5, 10])).toEqual([17, 28, 55]); // 16.67 / 27.78 / 55.56: two leftover points, two largest remainders
  });

  it("is all zeros when there is nothing to share", () => {
    expect(largestRemainder([0, 0, 0])).toEqual([0, 0, 0]);
    expect(largestRemainder([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The total must be the one the scorer divides by (B6: "khớp với tổng trọng số
// mà code dùng để tính điểm"). Check it against the real breakdown of a real solve.
// ---------------------------------------------------------------------------

describe("against the scorer", () => {
  const courses = buildMasks(
    ["CO2007", "CO2011"].flatMap((name) => parse(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8")).courses),
  ).courses;

  const cases: [string, PreferencesState][] = [
    ["default", state()],
    ["Sáng, slider 5", state(MORNING_5)],
    ["Chiều, slider 9", state((s) => { s.timeOfDay = { prefer: "afternoon", weight: 9 }; })],
    ["one preferred", state(ONE_PREFERRED)],
    ["two preferred", state((s) => { MORNING_5(s); TWO_PREFERRED(s); s.fewerDays = 2; s.avoidEarly = 9; })],
    ["switch off", state((s) => { TWO_PREFERRED(s); s.preferredSwitch = false; })],
    ["Không with a stored weight", state((s) => { s.timeOfDay = { prefer: "none", weight: 8 }; })],
    ["only fewerDays", state((s) => { s.fewerDays = 4; s.avoidEarly = 0; })],
  ];

  it.each(cases)("%s: the total and every share match the weights in the solver's breakdown", (_, s) => {
    const p = buildPreferences(s, NO_CHOICES)!;
    const result = solve(courses, p);
    expect(result.status).toBe("ok");
    const breakdown = result.schedules[0].breakdown;
    const weightOf = (item: string) => breakdown.find((b) => b.item === item)?.weight ?? 0;
    const scorerTotal = breakdown.reduce((sum, b) => sum + b.weight, 0);

    const r = computeShares(s);
    expect(r.total).toBe(scorerTotal);
    if (scorerTotal === 0) return;
    const within = (shown: number | null, weight: number) => {
      if (shown !== null) expect(Math.abs(shown - (100 * weight) / scorerTotal)).toBeLessThan(1);
    };
    within(r.timeOfDay.percent, weightOf("timeOfDay"));
    within(r.fewerDays.percent, weightOf("fewerDays"));
    within(r.avoidEarly.percent, weightOf("avoidEarly"));
    within(r.preferredItems.percent, weightOf("partsOff") + weightOf("freeSeats"));
  });
});

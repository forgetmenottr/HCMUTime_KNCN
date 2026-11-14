import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TABLES, formatter, translate, ui, type UiKey } from "../src/i18n";

// ---------------------------------------------------------------------------
// Agreement between a number and the noun after it, in English; and the curly
// apostrophe. Vietnamese has no plural, so only the digits are checked there.
// ---------------------------------------------------------------------------

/** Nouns that take a count in the English tables. Add one here when a string starts counting something new. */
const NOUNS = ["credit", "group", "course", "schedule", "option", "column", "second", "period", "week", "session", "program"];

/**
 * Every place where a number is followed by a noun that disagrees with it:
 * "1 groups", "2 group", "0 course". The number 1 takes the singular; every other
 * number, 0 and decimals included, takes the plural ("1.5 credits", "0 groups").
 * "Show 3 more groups" is covered by the optional "more".
 */
function agreementErrors(text: string): string[] {
  const errors: string[] = [];
  const pattern = new RegExp(`(?<![\\d.,])(\\d[\\d.,]*) (?:more )?(${NOUNS.join("|")})(s?)\\b`, "g");
  for (const [found, number, , s] of text.matchAll(pattern)) {
    const isOne = number === "1";
    if (isOne && s === "s") errors.push(`"${found}": 1 takes the singular`);
    if (!isOne && s === "") errors.push(`"${found}": ${number} takes the plural`);
  }
  return errors;
}

/** Counts worth trying: zero, one, small, a decimal (credits can be 2.5), and one with a thousands separator. */
const COUNTS = [0, 1, 2, 3, 5, 10, 1.5, 2.5, 21, 1000];

/** One value for every slot the UI strings use, as in tests/i18n.test.ts. */
const BASE_PARAMS = {
  line: 12,
  prefix: "XYZ",
  from: 1,
  to: 6,
  p: 63,
  v: 5,
  course: "CO2007",
  program: "L",
  available: ["A", "CC"],
  item: "partsOff",
  courses: ["CO2007", "CO2011"],
  list: ["A03_A03", "A05_A05"],
  periods: [2, 3, 4],
  weeks: [1, 2, 3, 5],
  ms: 2340,
  group: "L01_L01",
};

const UI_KEYS = Object.keys(TABLES.vi.ui) as UiKey[];

describe("the agreement check itself", () => {
  it("accepts the right form and flags the wrong one", () => {
    for (const ok of ["1 group", "0 groups", "2 groups", "1.5 credits", "1 credit", "Show 1 more group", "Show 14 more groups", "1,000 groups"]) {
      expect(agreementErrors(ok), ok).toEqual([]);
    }
    for (const bad of ["1 groups", "2 group", "0 group", "1.5 credit", "Show 1 more groups", "Show 14 more group", "1 credits"]) {
      expect(agreementErrors(bad), bad).not.toEqual([]);
    }
  });

  it("ignores a noun that comes BEFORE its number, which is how the tables write 'Period 3' and 'Weeks 1–7'", () => {
    expect(agreementErrors("Period 3, Periods 2–4, Week 6, Weeks 1–7, Option 2")).toEqual([]);
  });
});

describe("new keys: courses.colSessions, courses.groupCount, courses.showMore", () => {
  const en = (key: UiKey, n?: unknown) => ui(key, n === undefined ? {} : { n }, "en");
  const vi = (key: UiKey, n?: unknown) => ui(key, n === undefined ? {} : { n }, "vi");

  it("names the column 'Lịch' / 'Class times'", () => {
    expect(vi("courses.colSessions")).toBe("Lịch");
    expect(en("courses.colSessions")).toBe("Class times");
  });

  it("does not use 'Schedule' for the column: that word already means the timetable", () => {
    expect(en("courses.colSessions")).not.toMatch(/schedule/i);
  });

  it("counts groups: singular at 1, plural for everything else including 0", () => {
    expect(en("courses.groupCount", 0)).toBe("0 groups");
    expect(en("courses.groupCount", 1)).toBe("1 group");
    expect(en("courses.groupCount", 2)).toBe("2 groups");
    expect(en("courses.groupCount", 19)).toBe("19 groups");
    expect(en("courses.groupCount", 1000)).toBe("1,000 groups");
    expect(vi("courses.groupCount", 0)).toBe("0 nhóm");
    expect(vi("courses.groupCount", 1)).toBe("1 nhóm");
    expect(vi("courses.groupCount", 19)).toBe("19 nhóm");
  });

  it("offers more groups with the same agreement", () => {
    expect(en("courses.showMore", 0)).toBe("Show 0 more groups");
    expect(en("courses.showMore", 1)).toBe("Show 1 more group");
    expect(en("courses.showMore", 14)).toBe("Show 14 more groups");
    expect(vi("courses.showMore", 1)).toBe("Xem thêm 1 nhóm");
    expect(vi("courses.showMore", 14)).toBe("Xem thêm 14 nhóm");
  });

  it("picks the form with Intl.PluralRules, so a number the UI passes as a string or leaves out never prints 'undefined'", () => {
    expect(en("courses.groupCount")).toBe("? groups");
    expect(vi("courses.groupCount")).toBe("? nhóm");
    expect(en("courses.showMore")).toBe("Show ? more groups");
    expect(en("courses.groupCount", "5")).not.toMatch(/undefined|NaN/);
  });
});

describe("English: every count-bearing string agrees with its number", () => {
  it.each(COUNTS)("UI strings with the count %s", (count) => {
    const params = { ...BASE_PARAMS, n: count, m: count };
    for (const key of UI_KEYS) expect(agreementErrors(ui(key, params, "en")), `${key} (n=${count})`).toEqual([]);
  });

  it.each(COUNTS)("UI strings with %s in the one slot they have apart from n", (count) => {
    // courses.totalCreditsPartial has two counts at once: credits (n) and courses left out (m).
    const credits = ui("courses.totalCreditsPartial", { n: 12, m: count }, "en");
    expect(agreementErrors(credits), credits).toEqual([]);
    const other = ui("courses.totalCreditsPartial", { n: count, m: 2 }, "en");
    expect(agreementErrors(other), other).toEqual([]);
  });

  it("courses.credits for the credit counts of the fixtures and for a one-credit course", () => {
    // The fixtures hold courses of 3, 4, 4, 3, 0 and 3 credits: none has exactly 1, so this pins the case they do not cover.
    expect(ui("courses.credits", { n: 1 }, "en")).toBe("1 credit");
    expect(ui("courses.credits", { n: 0 }, "en")).toBe("0 credits");
    expect(ui("courses.credits", { n: 3 }, "en")).toBe("3 credits");
    expect(ui("courses.totalCredits", { n: 1 }, "en")).toBe("Total: 1 credit");
  });

  it.each(COUNTS)("messages from the solver and the parser with the count %s", (count) => {
    const texts = [
      translate("solver", { code: "dropped-conflicting", params: { count } }, "en"),
      translate("solver", { code: "all-excluded", params: { course: "CO2007", count } }, "en"),
      translate("parse", { code: "period-column-count", params: { expected: 16, found: count } }, "en"),
    ];
    for (const text of texts) expect(agreementErrors(text), text).toEqual([]);
  });

  it("lists of one or several items: programs, groups, constraints, weeks", () => {
    for (const list of [["A"], ["A", "CC"], ["A", "CC", "TN"]]) {
      for (const text of [
        ui("results.noProgram", { course: "CO2003", program: list }, "en"),
        ui("results.noProgramWhy", { available: list }, "en"),
        translate("solver", { code: "course-no-program", params: { course: "CO2003", allowed: list, available: list } }, "en"),
        translate("solver", { code: "conflicts-with-locked", params: { course: "CO2011", locked: list.map((id) => `CO2007:${id}`) } }, "en"),
        translate("solver", { code: "relaxed", params: { weight: 1000, constraints: list.map(() => "freeSeats") } }, "en"),
      ]) {
        expect(agreementErrors(text), text).toEqual([]);
      }
    }
  });

  it("the fractional seconds of the search time", () => {
    for (const ms of [1000, 1049, 1050, 1500, 2000, 2340, 60_000]) {
      const text = ui("results.stats", { ms }, "en");
      expect(agreementErrors(text), `${ms} ms: ${text}`).toEqual([]);
    }
    expect(ui("results.stats", { ms: 1000 }, "en")).toBe("Searched in 1 second");
    expect(ui("results.stats", { ms: 2000 }, "en")).toBe("Searched in 2 seconds");
  });

  it("the number formatter and the plural rule use the same language, so 1,000 is plural", () => {
    expect(formatter("en").plural(1000, { one: "# group", other: "# groups" })).toBe("1,000 groups");
  });
});

describe("the curly apostrophe", () => {
  const APOSTROPHE = "’";
  const sourceOf = (name: string) =>
    readFileSync(new URL(`../src/i18n/${name}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("writes the exclude name with U+2019, exactly as the drawing shows it", () => {
    const name = TABLES.en.name.exclude!;
    expect(name).toBe(`Don${APOSTROPHE}t take this group`);
    expect(name.codePointAt(3)).toBe(0x2019);
    expect(ui("courses.exclude", {}, "en")).toBe(name);
    expect(formatter("en").name("exclude")).toBe(name);
  });

  it("uses no straight apostrophe inside a word anywhere in the English or Vietnamese tables (comments aside)", () => {
    for (const file of ["en.ts", "vi.ts"]) {
      const inWords = [...sourceOf(file).matchAll(/\p{L}'\p{L}/gu)].map((m) => m[0]);
      expect(inWords, file).toEqual([]);
    }
  });

  it("every contraction rendered in English uses the curly one", () => {
    const sample = { ...BASE_PARAMS, n: 3, m: 1, count: 3 };
    const texts = UI_KEYS.map((key) => ui(key, sample, "en"));
    texts.push(...Object.values(TABLES.en.name));
    for (const text of texts) {
      expect(text).not.toContain("'");
      expect(text).not.toMatch(/\p{L}'\p{L}/u);
    }
    expect(texts.some((text) => text.includes(`n${APOSTROPHE}t`))).toBe(true); // at least one exists, so the check above is not vacuous
  });
});

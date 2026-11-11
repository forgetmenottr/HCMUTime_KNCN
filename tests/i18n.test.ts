import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatter,
  label,
  LANG_STORAGE_KEY,
  LANGS,
  NAME_KEYS,
  readLang,
  setLang,
  setMissingHandler,
  subscribeLang,
  getLang,
  TABLES,
  translate,
  ui,
  writeLang,
  type CodeSection,
  type Coded,
  type Lang,
  type LangStore,
  type Section,
  type UiKey,
} from "../src/i18n";
import { COMPLETE } from "../src/i18n/status";
import { PARSE_WARNING_CODES } from "../src/lib/parser";
import { CONSTRAINTS, SOLVER_DIAGNOSTIC_CODES } from "../src/lib/solver";
import { TIME_WARNING_CODES } from "../src/lib/timing";

// ---------------------------------------------------------------------------
// Sample items for every code, built from what `lib` emits (see data-contract §4).
// Codes with a count or a list get a one-item and a many-item case, for plurals.
// ---------------------------------------------------------------------------

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16];
const AT = { courseCode: "CO2007", groupId: "A01_A01" };

const SAMPLES: Record<CodeSection, Record<string, Coded[]>> = {
  parse: {
    "internal-error": [{ code: "", params: { error: "TypeError: x is undefined" } }],
    "unrecognized-line": [{ code: "", params: {} }],
    "group-before-course": [{ code: "", params: {} }],
    "invalid-group-id": [{ code: "", params: { id: "A1" } }],
    "missing-registered-capacity": [{ code: "", params: {} }],
    "missing-language": [{ code: "", params: {} }],
    "session-without-group": [{ code: "", params: {} }],
    "session-no-day": [{ code: "", params: {} }],
    "session-no-room": [{ code: "", params: {} }],
    "session-no-weeks": [{ code: "", params: {} }],
    "session-no-periods": [{ code: "", params: {} }],
    "period-column-count": [{ code: "", params: { expected: 16, found: 1 } }, { code: "", params: { expected: 16, found: 15 } }],
    "period-misplaced": [{ code: "", params: {} }],
    "week-digit-mismatch": [{ code: "", params: { weeks: [10] } }, { code: "", params: { weeks: [10, 11, 12, 14] } }],
    "unknown-campus": [{ code: "", params: { campus: "3" } }, { code: "", params: { campus: "" } }],
    "no-teaching-week": [{ code: "", params: {} }],
    "no-courses-found": [{ code: "", params: {}, line: 0, text: "" }],
  },
  timing: {
    "duplicate-course": [{ code: "", params: {}, courseCode: "CO2007", groupId: "" }],
    "duplicate-group": [{ code: "", params: {}, ...AT }],
    "slots-out-of-range": [1, 15].map((count) => ({
      code: "",
      ...AT,
      params: { session: 1, count, day: 2, maxWeek: 30, periods: 16, sessionPeriods: [2, 3, 4, 17], room: "A4-409" },
    })),
    "internal-overlap": [{ code: "", ...AT, params: { session: 2, other: 1, day: 4, sessionPeriods: [10, 11, 12], room: "C6-102" } }],
    "group-no-sessions": [{ code: "", params: {}, ...AT }],
  },
  solver: {
    "no-courses": [{ code: "", params: {} }],
    "dropped-conflicting": [{ code: "", params: { count: 1 } }, { code: "", params: { count: 3 } }],
    "course-blocked": [
      { code: "", params: { course: "SK2001", constraints: ["partsOff"] } },
      { code: "", params: { course: "SK2001", constraints: ["partsOff", "freeSeats"] } },
    ],
    "course-blocked-combined": [{ code: "", params: { course: "SK2001", constraints: ["partsOff", "freeSeats"] } }],
    "no-combination-required": [
      { code: "", params: { constraints: ["partsOff"] } },
      { code: "", params: { constraints: ["programs", "partsOff", "freeSeats"] } },
    ],
    "course-no-program": [
      { code: "", params: { course: "SK2001", allowed: ["L"], available: ["A"] } },
      { code: "", params: { course: "SK2001", allowed: ["L"], available: ["A", "CC"] } },
    ],
    relaxed: [
      { code: "", params: { weight: 1000, constraints: ["programs"] } },
      { code: "", params: { weight: 1000, constraints: ["partsOff", "freeSeats"] } },
    ],
    "course-no-groups": [{ code: "", params: { course: "CO2007" } }],
    "all-excluded": [{ code: "", params: { course: "CO2007", count: 1 } }, { code: "", params: { course: "CO2007", count: 5 } }],
    "locked-excluded": [{ code: "", params: { course: "CO2007", key: "CO2007:A01_A01" } }],
    "locked-missing": [{ code: "", params: { course: "CO2007", key: "CO2007:Z99" } }],
    "locked-overlap": [
      { code: "", params: { a: "CO2007:A01_A01", b: "CO2011:L01", overlap: [{ day: 2, periods: [2, 3], weeks: WEEKS }] } },
      {
        code: "",
        params: {
          a: "CO2007:A01_A01",
          b: "CO2011:L01",
          overlap: [
            { day: 2, periods: [2, 3], weeks: WEEKS },
            { day: 8, periods: [8, 9, 10], weeks: [6, 10, 12, 14] },
          ],
        },
      },
    ],
    "conflicts-with-locked": [
      { code: "", params: { course: "CO2011", locked: ["CO2007:L01_L01"] } },
      { code: "", params: { course: "CO2011", locked: ["CO2007:L01_L01", "CO2003:L02_L03"] } },
    ],
    "no-combination": [{ code: "", params: { afterRelax: false } }, { code: "", params: { afterRelax: true } }],
    truncated: [{ code: "", params: { nodes: 4_200_000, maxNodes: 5_000_000 } }],
  },
};

/** Every key each section must have once it is declared complete. */
const EXPECTED_KEYS: Record<Exclude<Section, "ui">, readonly (string | number)[]> = {
  parse: PARSE_WARNING_CODES,
  timing: TIME_WARNING_CODES,
  solver: SOLVER_DIAGNOSTIC_CODES,
  constraint: CONSTRAINTS,
  dayLong: [2, 3, 4, 5, 6, 7, 8],
  dayShort: [2, 3, 4, 5, 6, 7, 8],
  partOff: ["morning", "afternoon"],
  partStudy: ["morning", "afternoon"],
  campus: [1, 2],
  kind: ["theory", "lab"],
  name: NAME_KEYS,
};

/** Vietnamese is the source of truth for UI keys: English must match them exactly. */
function expectedKeys(section: Section): string[] {
  const keys = section === "ui" ? Object.keys(TABLES.vi.ui) : EXPECTED_KEYS[section];
  return keys.map(String).sort();
}

const CODE_SECTIONS: CodeSection[] = ["parse", "timing", "solver"];
const BAD_OUTPUT = /undefined|NaN|\[object|[{}]/;

afterEach(() => setMissingHandler(() => {}));

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

describe("i18n completeness", () => {
  it("has a sample for every code, so a finished section is fully rendered below", () => {
    expect(Object.keys(SAMPLES.parse).sort()).toEqual([...PARSE_WARNING_CODES].sort());
    expect(Object.keys(SAMPLES.timing).sort()).toEqual([...TIME_WARNING_CODES].sort());
    expect(Object.keys(SAMPLES.solver).sort()).toEqual([...SOLVER_DIAGNOSTIC_CODES].sort());
  });

  it("never has a key that is not a real code, in any section, finished or not", () => {
    for (const lang of LANGS) {
      for (const section of Object.keys(TABLES[lang]) as Section[]) {
        const allowed = new Set(expectedKeys(section));
        for (const key of Object.keys(TABLES[lang][section])) expect(allowed.has(key), `${lang}.${section}.${key}`).toBe(true);
      }
    }
  });

  it.each(LANGS)("has every key of every section declared complete (%s)", (lang) => {
    for (const section of COMPLETE[lang]) {
      expect(Object.keys(TABLES[lang][section]).sort(), `${lang}.${section}`).toEqual(expectedKeys(section));
    }
  });

  it.each(LANGS)("renders every code of a complete section from its own table, with no broken output (%s)", (lang) => {
    const misses: string[] = [];
    setMissingHandler(({ section, key }) => misses.push(`${section}.${key}`));
    for (const section of CODE_SECTIONS.filter((s) => COMPLETE[lang].includes(s))) {
      for (const [code, items] of Object.entries(SAMPLES[section])) {
        for (const item of items) {
          const text = translate(section, { ...item, code }, lang);
          expect(text.trim(), `${lang}.${section}.${code}`).not.toBe("");
          expect(text, `${lang}.${section}.${code}`).not.toMatch(BAD_OUTPUT);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it.each(LANGS)("hides relaxed.weight and truncated.maxNodes (%s)", (lang) => {
    const fmt = formatter(lang);
    if (COMPLETE[lang].includes("solver")) {
      for (const item of SAMPLES.solver.relaxed) {
        expect(translate("solver", { ...item, code: "relaxed" }, lang)).not.toContain(fmt.num(1000));
      }
      expect(translate("solver", { ...SAMPLES.solver.truncated[0], code: "truncated" }, lang)).not.toContain(fmt.num(5_000_000));
    }
  });
});

// ---------------------------------------------------------------------------
// Lookup and fallback chain
// ---------------------------------------------------------------------------

describe("translate fallback chain", () => {
  const UNKNOWN = { code: "made-up-code", params: {}, message: "lib's own English text" };

  it("uses lib's English message in English mode when the code has no translation", () => {
    expect(translate("parse", UNKNOWN, "en")).toBe("lib's own English text");
  });

  it("never shows lib's English message in Vietnamese mode", () => {
    expect(translate("parse", UNKNOWN, "vi")).toBe("Có vấn đề chưa xác định (mã made-up-code)");
  });

  it("ends at 'unknown issue (code X)' in the chosen language, never blank or undefined", () => {
    expect(translate("solver", { code: "made-up-code" }, "en")).toBe("Unknown issue (code made-up-code)");
    expect(translate("solver", { code: "" }, "en")).toBe("Unknown issue (code ?)");
    expect(translate("timing", { code: undefined as unknown as string }, "vi")).toBe("Có vấn đề chưa xác định (mã ?)");
    expect(translate("parse", { code: "x", message: "   " }, "en")).toBe("Unknown issue (code x)");
  });

  it("falls back to Vietnamese in English mode when only Vietnamese has the code", () => {
    const table = TABLES.vi.parse as Record<string, unknown>;
    table["test-only-code"] = "Chỉ có tiếng Việt: {line}";
    try {
      expect(translate("parse", { code: "test-only-code", params: {}, line: 7 }, "en")).toBe("Chỉ có tiếng Việt: 7");
    } finally {
      delete table["test-only-code"];
    }
  });

  it("passes context fields to the template and shows '?' for a missing param", () => {
    const table = TABLES.vi.timing as Record<string, unknown>;
    table["test-only-code"] = "{courseCode} / {groupId} / {room} / {nothing}";
    try {
      const text = translate("timing", { code: "test-only-code", courseCode: "CO2007", groupId: "A01", params: { room: "C5-202" } }, "vi");
      expect(text).toBe("CO2007 / A01 / C5-202 / ?");
    } finally {
      delete table["test-only-code"];
    }
  });

  it("moves on when a message function throws or returns blank", () => {
    const table = TABLES.en.solver as Record<string, unknown>;
    table["test-only-code"] = () => {
      throw new Error("bug");
    };
    try {
      expect(translate("solver", { code: "test-only-code", message: "fallback text" }, "en")).toBe("fallback text");
      table["test-only-code"] = () => "  ";
      expect(translate("solver", { code: "test-only-code" }, "en")).toBe("Unknown issue (code test-only-code)");
    } finally {
      delete table["test-only-code"];
    }
  });

  it("reports each missing key once per language", () => {
    const misses: string[] = [];
    setMissingHandler(({ lang, section, key }) => misses.push(`${lang}:${section}:${key}`));
    translate("parse", { code: "made-up-code" }, "en");
    translate("parse", { code: "made-up-code" }, "en");
    translate("parse", { code: "made-up-code" }, "vi");
    expect(misses).toEqual(["en:parse:made-up-code", "vi:parse:made-up-code"]);
  });

  it("labels an unknown constraint as itself and an unknown UI key as the key", () => {
    expect(label("not-a-constraint", "en")).toBe("not-a-constraint");
    expect(label(undefined, "vi")).toBe("?");
    expect(ui("no.such.key" as UiKey, {}, "en")).toBe("no.such.key");
  });
});

// ---------------------------------------------------------------------------
// Constraint labels and data values (stage 2)
// ---------------------------------------------------------------------------

describe("constraint labels and data values", () => {
  it.each(LANGS)("labels daysOff as the merged 'Ngày/buổi nghỉ' control, the same as partsOff (%s)", (lang) => {
    expect(label("daysOff", lang)).toBe(label("partsOff", lang));
  });

  it("uses the control names the screen shows, in Vietnamese", () => {
    expect(label("partsOff", "vi")).toBe("Ngày/buổi nghỉ");
    expect(label("daysOff", "vi")).toBe("Ngày/buổi nghỉ");
    expect(label("freeSeats", "vi")).toBe("Còn chỗ trống");
    expect(label("programs", "vi")).toBe("Chương trình đào tạo");
  });

  it.each(LANGS)("reports never-sent constraints as unexpected, once, and still labels them readably (%s)", (lang) => {
    const reports: string[] = [];
    setMissingHandler(({ key, reason }) => reports.push(`${key}:${reason}`));
    for (const name of ["programs", "partsOff", "freeSeats"]) label(name, lang); // reachable: silent
    for (const name of ["campuses", "language", "avoidLecturers", "daysOff", "campuses"]) {
      const text = label(name, lang);
      expect(text.trim(), name).not.toBe("");
      expect(text, name).not.toBe(name);
    }
    expect(reports).toEqual(["campuses:unexpected", "language:unexpected", "avoidLecturers:unexpected", "daysOff:unexpected"]);
  });

  it.each(LANGS)("keeps 'want off' and 'want to study' half-days as separate key sets (%s)", (lang) => {
    expect(TABLES[lang].partOff).not.toBe(TABLES[lang].partStudy);
    expect(Object.keys(TABLES[lang].partOff).sort()).toEqual(["afternoon", "morning"]);
    expect(Object.keys(TABLES[lang].partStudy).sort()).toEqual(["afternoon", "morning"]);
  });

  it("names days in both forms and joins constraint labels into a list", () => {
    expect(formatter("vi").day(2)).toBe("Thứ 2");
    expect(formatter("vi").day(8, "short")).toBe("CN");
    expect(formatter("en").day(8)).toBe("Sunday");
    expect(formatter("en").day(9)).toBe("9"); // out of range: the number, never blank
    const fmt = formatter("vi");
    expect(fmt.list(["partsOff", "freeSeats"], fmt.constraint)).toBe("Ngày/buổi nghỉ và Còn chỗ trống");
  });
});

// ---------------------------------------------------------------------------
// Vietnamese UI strings (stage 3)
// ---------------------------------------------------------------------------

/** One value for every slot a UI string uses; a slot missing here shows up as "?". */
const UI_PARAMS = {
  line: 12,
  n: 3,
  m: 1,
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
};

/** The only Vietnamese UI strings whose own text contains "?". */
const LITERAL_QUESTION_MARK = new Set(["courses.creditsUnknown", "prefs.block.schedule", "prefs.timeOfDay.label"]);

describe("Vietnamese UI strings", () => {
  const keys = Object.keys(TABLES.vi.ui) as UiKey[];

  it("renders every key from its own table, with every slot filled", () => {
    const misses: string[] = [];
    setMissingHandler(({ section, key }) => misses.push(`${section}.${key}`));
    for (const key of keys) {
      const text = ui(key, UI_PARAMS, "vi");
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toBe(key);
      expect(text, key).not.toMatch(BAD_OUTPUT);
      if (!LITERAL_QUESTION_MARK.has(key)) expect(text, key).not.toContain("?");
    }
    expect(misses).toEqual([]);
  });

  it("shows '?' rather than 'undefined' when a slot is not given", () => {
    for (const key of keys) expect(ui(key, {}, "vi"), key).not.toMatch(BAD_OUTPUT);
  });

  it("names the constraint in a violation chip the way the control is named", () => {
    expect(ui("results.violation", { item: "partsOff", courses: ["CO2007"] }, "vi")).toBe("Ngày/buổi nghỉ: CO2007");
    expect(ui("results.violation", { item: "freeSeats", courses: ["CO2007", "CO2011"] }, "vi")).toBe("Còn chỗ trống: CO2007 và CO2011");
  });

  it("formats numbers, runs and lists the Vietnamese way", () => {
    expect(ui("courses.totalCredits", { n: 10.5 }, "vi")).toBe("Tổng 10,5 tín chỉ");
    expect(ui("courses.weeks", { weeks: [1, 2, 3, 4, 5, 6, 7, 9, 10] }, "vi")).toBe("Tuần 1–7, 9–10");
    expect(ui("courses.periods", { periods: [8, 9] }, "vi")).toBe("Tiết 8–9");
    expect(ui("results.noProgramWhy", { available: ["A", "CC"] }, "vi")).toBe("Môn này chỉ còn lớp của chương trình A và CC.");
    // Alternatives are "either one", so they are not joined with "và".
    expect(ui("results.alternatives", { list: ["A03_A03", "A05_A05"] }, "vi")).toBe("Cũng được: A03_A03, A05_A05");
  });

  it("states search time in seconds, never as '0 giây'", () => {
    expect(ui("results.stats", { ms: 40 }, "vi")).toBe("Tìm trong chưa đầy 1 giây");
    expect(ui("results.stats", { ms: 2340 }, "vi")).toBe("Tìm trong 2,3 giây");
  });

  it("labels the two constraint controls with the exact names messages use", () => {
    expect(ui("prefs.partsOff.label", {}, "vi")).toBe(label("partsOff", "vi"));
    expect(ui("prefs.freeSeats.label", {}, "vi")).toBe(label("freeSeats", "vi"));
  });

  it("writes each shared control name once, and every sentence that names it uses that form", () => {
    const fmt = formatter("vi");
    expect(fmt.name("lock")).toBe("Chỉ học lớp này");
    expect(fmt.name("exclude")).toBe("Không học lớp này");
    expect(fmt.name("preferredSwitch")).toBe("Tính cả các mục “Ưu tiên”");
    expect(ui("courses.lock", {}, "vi")).toBe(fmt.name("lock"));
    expect(ui("courses.exclude", {}, "vi")).toBe(fmt.name("exclude"));
    expect(ui("prefs.preferredSwitch.label", {}, "vi")).toBe(fmt.name("preferredSwitch"));
    for (const key of ["prefs.mode.preferredTip", "prefs.preferredSwitch.disabledTip"] as UiKey[]) {
      expect(ui(key, {}, "vi"), key).toContain(fmt.name("preferredSwitch"));
    }
    // No other spelling of the switch name survives anywhere in the table.
    for (const key of Object.keys(TABLES.vi.ui) as UiKey[]) {
      expect(ui(key, UI_PARAMS, "vi"), key).not.toMatch(/Tính cả các mục Ưu tiên|["'']Tính cả/);
    }
  });

  it("never mentions points, since no score is shown", () => {
    for (const key of Object.keys(TABLES.vi.ui) as UiKey[]) expect(ui(key, UI_PARAMS, "vi"), key).not.toMatch(/điểm/i);
  });

  it("states what the data lacks, not what the student cannot do, for course-no-program", () => {
    expect(ui("results.noProgram", { course: "CO2007", program: "L" }, "vi")).toBe("Môn CO2007 không còn lớp nào thuộc chương trình L.");
  });

  it("counts unknown-credit courses in the partial total", () => {
    expect(ui("courses.totalCreditsPartial", { n: 9, m: 1 }, "vi")).toBe("Tổng 9 tín chỉ (chưa tính 1 môn)");
  });

  it("keeps the mode names identical wherever a sentence refers to them", () => {
    const preferred = ui("prefs.mode.preferred", {}, "vi");
    for (const key of ["prefs.mode.preferredTip", "prefs.preferredSwitch.hint", "prefs.preferredSwitch.disabledTip", "prefs.preferredSwitch.paused"] as UiKey[]) {
      expect(ui(key, {}, "vi"), key).toContain(preferred);
    }
    expect(ui("results.relaxedTitle", {}, "vi")).toContain(ui("prefs.mode.required", {}, "vi"));
  });
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe("formatting helpers", () => {
  it("joins lists with each language's 'and'", () => {
    expect(formatter("vi").list(["A", "B", "C"])).toBe("A, B và C");
    expect(formatter("en").list(["A", "B"])).toBe("A and B");
    expect(formatter("en").list([])).toBe("?");
    expect(formatter("en").list("not a list")).toBe("?");
  });

  it("picks plural forms with Intl.PluralRules; Vietnamese has one form", () => {
    const forms = { one: "# group", other: "# groups" };
    expect(formatter("en").plural(1, forms)).toBe("1 group");
    expect(formatter("en").plural(5, forms)).toBe("5 groups");
    expect(formatter("en").plural(5_000_000, forms)).toBe("5,000,000 groups");
    expect(formatter("vi").plural(1, { other: "# lớp" })).toBe("1 lớp");
    expect(formatter("vi").num(5_000_000)).toBe("5.000.000");
    expect(formatter("en").plural(undefined, forms)).toBe("? groups");
  });

  it("formats runs of numbers the same way in both languages", () => {
    expect(formatter("vi").runs(WEEKS)).toBe("1–7, 9–16");
    expect(formatter("en").runs([6, 10, 12, 14])).toBe("6, 10, 12, 14");
    expect(formatter("en").runs([3, 1, 2, 2])).toBe("1–3");
    expect(formatter("en").runs([])).toBe("?");
  });

  it("never turns a missing or odd value into 'undefined' or 'NaN'", () => {
    const fmt = formatter("en");
    for (const value of [undefined, null, NaN, Infinity, "", "  ", {}, []]) {
      expect(fmt.str(value)).toBe("?");
      expect(fmt.num(value)).toBe("?");
    }
    expect(fmt.day(undefined)).toBe("?");
  });
});

// ---------------------------------------------------------------------------
// Language choice
// ---------------------------------------------------------------------------

describe("language choice", () => {
  function memoryStore(initial: Record<string, string> = {}): LangStore & { data: Record<string, string> } {
    const data = { ...initial };
    return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
  }
  const throwing: LangStore = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  it("reads hcmutime.lang and defaults to Vietnamese", () => {
    expect(LANG_STORAGE_KEY).toBe("hcmutime.lang");
    expect(readLang(memoryStore({ "hcmutime.lang": "en" }))).toBe("en");
    expect(readLang(memoryStore())).toBe("vi");
    expect(readLang(memoryStore({ "hcmutime.lang": "fr" }))).toBe("vi");
    expect(readLang(null)).toBe("vi");
    expect(readLang(throwing)).toBe("vi");
  });

  it("writes the choice, and ignores blocked storage", () => {
    const store = memoryStore();
    writeLang("en", store);
    expect(store.data).toEqual({ "hcmutime.lang": "en" });
    expect(() => writeLang("en", throwing)).not.toThrow();
  });

  it("switches the current language and notifies subscribers", () => {
    const seen: Lang[] = [];
    const stop = subscribeLang((lang) => seen.push(lang));
    const before = getLang();
    try {
      setLang("en");
      expect(getLang()).toBe("en");
      setLang("fr" as Lang); // ignored
      expect(getLang()).toBe("en");
      setLang("vi");
      expect(seen).toEqual(["en", "vi"]);
    } finally {
      stop();
      setLang(before);
    }
  });
});

// ---------------------------------------------------------------------------
// Layering: lib must not know about the UI or the i18n layer.
// ---------------------------------------------------------------------------

describe("layering", () => {
  it("src/lib never imports src/i18n, React, or browser storage", () => {
    const root = new URL("../src/lib/", import.meta.url);
    const files = readdirSync(root, { recursive: true }).map(String).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const name of files) {
      const source = readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8");
      expect(source, name).not.toMatch(/from\s+["'][^"']*i18n/);
      expect(source, name).not.toMatch(/from\s+["']react/);
      expect(source.replace(/\/\/.*$/gm, ""), name).not.toMatch(/\blocalStorage\b|\bdocument\.|\bwindow\./);
    }
  });
});

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
    // The raw error text is shown as a detail (plan §2.6); a real one may well contain
    // "undefined", which BAD_OUTPUT would flag, so the sample uses one that does not.
    "internal-error": [{ code: "", params: { error: "RangeError: Invalid array length" } }],
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
    "slots-out-of-range": [
      ...[1, 15].map((count) => ({
        code: "",
        ...AT,
        params: { session: 1, count, day: 2, maxWeek: 30, periods: 16, sessionPeriods: [2, 3, 4, 17], room: "A4-409" },
      })),
      // Every period in range: the cells were dropped for a week after 30.
      { code: "", ...AT, params: { session: 1, count: 3, day: 2, maxWeek: 30, periods: 16, sessionPeriods: [2, 3, 4], room: "A4-409" } },
    ],
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
      { code: "", params: { constraints: ["programs"] } }, // the UI's usual case: nothing the student set is required
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
// UI strings and code messages: the guards every language is held to (stages 3-5)
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

/** The only UI strings whose own text contains "?"; the same three keys in every language. */
const LITERAL_QUESTION_MARK = new Set(["courses.creditsUnknown", "prefs.block.schedule", "prefs.timeOfDay.label"]);

/**
 * What mentioning the (hidden) score looks like, per language. The results
 * screen shows no score, so no string may talk about one.
 * - Vietnamese: "điểm" covers điểm, điểm số, trừ điểm.
 * - English has two tells, "point(s)" and "score"/"scoring"; "penalty" is added
 *   because it is the lib's word for the same hidden number (`Schedule.penalty`).
 */
const POINTS: Record<Lang, RegExp> = {
  vi: /điểm/i,
  en: /\b(points?|scores?|scored|scoring|penalt(y|ies))\b/i,
};

/** The shared control names, exactly as each language writes them (docs/ui-change-analysis.md B1). */
const NAMES: Record<Lang, { lock: string; exclude: string; preferredSwitch: string }> = {
  vi: { lock: "Chỉ học lớp này", exclude: "Không học lớp này", preferredSwitch: "Tính cả các mục “Ưu tiên”" },
  en: { lock: "Take only this group", exclude: "Don’t take this group", preferredSwitch: "Count “Preferred” items" },
};

/** Any way of writing the switch name; each occurrence must be the exact form above. */
const SWITCH_SPELLING: Record<Lang, RegExp> = {
  vi: /Tính cả các mục\s*[“"'‘]?Ưu tiên[”"'’]?/g,
  en: /Count\s*[“"'‘]?Preferred[”"'’]?\s*items/g,
};

/** What a skipped session tells the student, per language: the group will be one session short. */
const SKIPPED_SESSION: Record<Lang, string> = {
  vi: "nhóm lớp sẽ thiếu buổi này",
  en: "the group will be missing this session",
};

/** Vietnamese letters (with diacritics); none may appear in English text except the placeholder hint and pasted data. */
const VIETNAMESE = /[ăâđêôơưàáạảãấầẩẫậắằẳẵặèéẹẻẽếềểễệìíịỉĩòóọỏõốồổỗộớờởỡợùúụủũứừửữựỳýỵỷỹ]/i;

const UI_KEYS = Object.keys(TABLES.vi.ui) as UiKey[];

/** Every code message of a section in a language, rendered from the samples. */
function allMessages(section: CodeSection, lang: Lang): { code: string; text: string }[] {
  return Object.entries(SAMPLES[section]).flatMap(([code, items]) =>
    items.map((item) => ({ code, text: translate(section, { ...item, code }, lang) })),
  );
}

/** One message in one language. */
const msg =
  (lang: Lang) =>
  (section: CodeSection, code: string, params: Record<string, unknown>, extra: Partial<Coded> = {}) =>
    translate(section, { code, params, ...extra }, lang);

describe.each(LANGS)("UI strings: shared rules (%s)", (lang) => {
  it("renders every key from its own table, with every slot filled", () => {
    const misses: string[] = [];
    setMissingHandler(({ section, key }) => misses.push(`${section}.${key}`));
    for (const key of UI_KEYS) {
      const text = ui(key, UI_PARAMS, lang);
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toBe(key);
      expect(text, key).not.toMatch(BAD_OUTPUT);
      if (!LITERAL_QUESTION_MARK.has(key)) expect(text, key).not.toContain("?");
    }
    expect(misses).toEqual([]);
  });

  it("shows '?' rather than 'undefined' when a slot is not given", () => {
    for (const key of UI_KEYS) expect(ui(key, {}, lang), key).not.toMatch(BAD_OUTPUT);
  });

  it("labels the constraint controls with the exact names the violation chips and messages use", () => {
    expect(ui("prefs.partsOff.label", {}, lang)).toBe(label("partsOff", lang));
    expect(ui("prefs.freeSeats.label", {}, lang)).toBe(label("freeSeats", lang));
    expect(ui("prefs.block.program", {}, lang)).toBe(label("programs", lang));
  });

  it("writes each shared control name once, and every sentence that names it uses that form", () => {
    const fmt = formatter(lang);
    const names = NAMES[lang];
    expect(fmt.name("lock")).toBe(names.lock);
    expect(fmt.name("exclude")).toBe(names.exclude);
    expect(fmt.name("preferredSwitch")).toBe(names.preferredSwitch);
    expect(ui("courses.lock", {}, lang)).toBe(names.lock);
    expect(ui("courses.exclude", {}, lang)).toBe(names.exclude);
    expect(ui("prefs.preferredSwitch.label", {}, lang)).toBe(names.preferredSwitch);
    for (const key of ["prefs.mode.preferredTip", "prefs.preferredSwitch.disabledTip"] as UiKey[]) {
      expect(ui(key, {}, lang), key).toContain(names.preferredSwitch);
    }
    // No other spelling of the switch name survives anywhere: every occurrence is the exact form.
    const texts = [
      ...UI_KEYS.map((key) => ui(key, UI_PARAMS, lang)),
      ...CODE_SECTIONS.flatMap((section) => allMessages(section, lang).map((m) => m.text)),
    ];
    for (const text of texts) for (const found of text.match(SWITCH_SPELLING[lang]) ?? []) expect(found).toBe(names.preferredSwitch);
  });

  it("never mentions points or a score, since none is shown", () => {
    for (const key of UI_KEYS) expect(ui(key, UI_PARAMS, lang), key).not.toMatch(POINTS[lang]);
    for (const key of UI_KEYS) expect(ui(key, {}, lang), key).not.toMatch(POINTS[lang]);
  });

  it("keeps the mode names identical wherever a sentence refers to them", () => {
    const preferred = ui("prefs.mode.preferred", {}, lang);
    for (const key of ["prefs.mode.preferredTip", "prefs.preferredSwitch.hint", "prefs.preferredSwitch.disabledTip", "prefs.preferredSwitch.paused"] as UiKey[]) {
      expect(ui(key, {}, lang), key).toContain(preferred);
    }
    expect(ui("results.relaxedTitle", {}, lang)).toContain(ui("prefs.mode.required", {}, lang));
  });

  it("names the constraint in a violation chip the way the control is named", () => {
    const chip = ui("results.violation", { item: "partsOff", courses: ["CO2007"] }, lang);
    expect(chip).toBe(`${ui("prefs.partsOff.label", {}, lang)}: CO2007`);
  });

  it("uses the same sentences on the result screen as in the course-no-program diagnostic", () => {
    const params = { course: "SK2001", allowed: ["L"], available: ["A", "CC"] };
    expect(msg(lang)("solver", "course-no-program", params)).toBe(
      `${ui("results.noProgram", { course: "SK2001", program: "L" }, lang)} ${ui("results.noProgramWhy", { available: ["A", "CC"] }, lang)}`,
    );
  });
});

describe.each(LANGS)("code messages: shared rules (%s)", (lang) => {
  it("never mentions points or a score, in any code message", () => {
    for (const section of CODE_SECTIONS) {
      for (const { code, text } of allMessages(section, lang)) expect(text, `${section}.${code}`).not.toMatch(POINTS[lang]);
    }
  });

  it("writes the mode names exactly as the mode selector shows them", () => {
    const modes = [ui("prefs.mode.required", {}, lang), ui("prefs.mode.preferred", {}, lang)];
    for (const { code, text } of allMessages("solver", lang)) {
      for (const mode of modes) {
        for (const found of text.match(new RegExp(mode, "gi")) ?? []) expect(found, code).toBe(mode);
      }
    }
  });

  it("quotes only names that are on screen, in solver messages", () => {
    const fmt = formatter(lang);
    const onScreen = new Set([
      fmt.name("lock"),
      fmt.name("exclude"),
      ui("courses.include", {}, lang),
      ui("step.courses", {}, lang),
      ...CONSTRAINTS.map((c) => label(c, lang)), // control labels, quoted where a list of them could blur
    ]);
    for (const { code, text } of allMessages("solver", lang)) {
      for (const [, quoted] of text.matchAll(/“([^”]*)”/g)) expect(onScreen.has(quoted), `${code}: “${quoted}”`).toBe(true);
    }
  });

  it("tells the student a skipped session leaves its group short", () => {
    for (const code of ["session-no-day", "session-no-room", "session-no-weeks", "session-no-periods"]) {
      expect(msg(lang)("parse", code, {}), code).toContain(SKIPPED_SESSION[lang]);
    }
  });

  it("only advises switching the constraints the student set themselves", () => {
    const preferred = ui("prefs.mode.preferred", {}, lang);
    expect(msg(lang)("solver", "no-combination-required", { constraints: ["programs"] })).not.toContain(preferred);
    const combined = msg(lang)("solver", "course-blocked-combined", { course: "SK2001", constraints: ["programs", "partsOff"] });
    expect(combined).toContain(label("partsOff", lang));
    expect(combined.split(preferred)).toHaveLength(2); // advises once, and names only the student's own control
    expect(combined.slice(combined.indexOf(preferred) - 60, combined.indexOf(preferred))).toContain(label("partsOff", lang));
    expect(combined.slice(combined.indexOf(preferred) - 60, combined.indexOf(preferred))).not.toContain(label("programs", lang));
  });

  it("has two whole sentences for no-combination, chosen by afterRelax", () => {
    const required = ui("prefs.mode.required", {}, lang);
    const before = msg(lang)("solver", "no-combination", { afterRelax: false });
    const after = msg(lang)("solver", "no-combination", { afterRelax: true });
    expect(before).not.toBe(after);
    expect(after).toContain(required);
    expect(before).not.toContain(required);
  });
});

describe("English never shows Vietnamese by accident", () => {
  it("has no Vietnamese in any UI string, except the placeholder hint", () => {
    for (const key of UI_KEYS.filter((k) => k !== "paste.hint")) expect(ui(key, UI_PARAMS, "en"), key).not.toMatch(VIETNAMESE);
  });

  it("has no Vietnamese in any code message", () => {
    for (const section of CODE_SECTIONS) {
      for (const { code, text } of allMessages(section, "en")) expect(text, `${section}.${code}`).not.toMatch(VIETNAMESE);
    }
  });

  it("keeps the placeholder hint untranslated, identical to the Vietnamese one, until the owner writes it", () => {
    // When the real sentence exists, write both languages and update this test.
    expect(TABLES.en.ui["paste.hint"]).toBe(TABLES.vi.ui["paste.hint"]);
  });

  it("leaves pasted data as it is: Vietnamese names inside English sentences", () => {
    expect(translate("parse", { code: "invalid-group-id", params: { id: "Nhóm 1" } }, "en")).toContain("“Nhóm 1”");
    expect(translate("parse", { code: "unknown-campus", params: { campus: "Dĩ An" } }, "en")).toContain("“Dĩ An”");
    expect(ui("results.violation", { item: "freeSeats", courses: ["Kiến trúc máy tính"] }, "en")).toBe("Seats left: Kiến trúc máy tính");
  });
});

// ---------------------------------------------------------------------------
// Vietnamese: exact wording
// ---------------------------------------------------------------------------

describe("Vietnamese UI strings", () => {
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

  it("states what the data lacks, not what the student cannot do, for course-no-program", () => {
    expect(ui("results.noProgram", { course: "CO2007", program: "L" }, "vi")).toBe("Môn CO2007 không còn lớp nào thuộc chương trình L.");
  });

  it("counts unknown-credit courses in the partial total", () => {
    expect(ui("courses.totalCreditsPartial", { n: 9, m: 1 }, "vi")).toBe("Tổng 9 tín chỉ (chưa tính 1 môn)");
  });
});

describe("Vietnamese messages for codes", () => {
  const vi = msg("vi");

  it("says 'missing' for an empty campus and quotes any other value", () => {
    expect(vi("parse", "unknown-campus", { campus: "" })).toMatch(/^Buổi học này thiếu cơ sở/);
    expect(vi("parse", "unknown-campus", { campus: "3" })).toMatch(/^Cơ sở “3” không phải 1 hoặc 2/);
  });

  it("names the session by day, periods and room, and tells periods from weeks", () => {
    const base = { day: 2, maxWeek: 30, periods: 16, room: "A4-409", count: 3, session: 1 };
    expect(vi("timing", "slots-out-of-range", { ...base, sessionPeriods: [16, 17] })).toMatch(
      /^Buổi Thứ 2, tiết 16–17, phòng A4-409 có tiết nằm ngoài tiết 1–16;/,
    );
    expect(vi("timing", "slots-out-of-range", { ...base, sessionPeriods: [2, 3, 4] })).toMatch(
      /^Buổi Thứ 2, tiết 2–4, phòng A4-409 có tuần học sau tuần 30;/,
    );
    expect(
      vi("timing", "internal-overlap", { session: 2, other: 1, day: 4, sessionPeriods: [10, 11, 12], room: "C6-102" }, { groupId: "A01_A01" }),
    ).toMatch(/^Buổi Thứ 4, tiết 10–12, phòng C6-102 trùng giờ với một buổi khác của cùng nhóm lớp A01_A01\./);
  });

  it("gives all-excluded its own sentence for a course with a single group", () => {
    expect(vi("solver", "all-excluded", { course: "CO2007", count: 1 })).toBe(
      "Môn CO2007 chỉ có một lớp, và bạn đã chọn “Không học lớp này” cho lớp đó. Hãy bỏ lựa chọn đó, hoặc bỏ chọn “Xếp lịch cho môn này”.",
    );
    expect(vi("solver", "all-excluded", { course: "CO2007", count: 5 })).toMatch(/^Bạn đã chọn “Không học lớp này” cho cả 5 lớp của môn CO2007\./);
  });

  it("has Vietnamese mode wording in no-combination", () => {
    expect(vi("solver", "no-combination", { afterRelax: true })).toContain("kể cả khi cho phép vi phạm các mục Bắt buộc");
  });

  it("only advises switching the constraints the student set themselves", () => {
    expect(vi("solver", "course-blocked-combined", { course: "SK2001", constraints: ["programs", "partsOff"] })).toBe(
      "Không lớp nào của môn SK2001 đáp ứng cùng lúc Chương trình đào tạo và Ngày/buổi nghỉ. Hãy chuyển Ngày/buổi nghỉ sang Ưu tiên.",
    );
  });

  it("rebuilds locked-overlap from day names and period and week runs", () => {
    const params = {
      a: "CO2007:A01_A01",
      b: "CO2011:L01",
      overlap: [
        { day: 2, periods: [2, 3], weeks: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16] },
        { day: 8, periods: [8, 9, 10], weeks: [6, 10, 12, 14] },
      ],
    };
    expect(vi("solver", "locked-overlap", params)).toBe(
      "Hai lớp bạn đã chọn “Chỉ học lớp này” trùng giờ nhau: A01_A01 (CO2007) và L01 (CO2011), vào Thứ 2, tiết 2–3 (tuần 1–7, 9–16); Chủ nhật, tiết 8–10 (tuần 6, 10, 12, 14). Hãy bỏ lựa chọn ở một trong hai lớp.",
    );
    expect(vi("solver", "locked-overlap", { a: "CO2007:A01_A01", b: "CO2011:L01" })).not.toMatch(BAD_OUTPUT);
  });
});

// ---------------------------------------------------------------------------
// English: exact wording, and the agreement Vietnamese does not need
// ---------------------------------------------------------------------------

describe("English UI strings", () => {
  const en = (key: UiKey, params: Record<string, unknown> = {}) => ui(key, params, "en");

  it("names the constraint in a violation chip the way the control is named", () => {
    expect(en("results.violation", { item: "partsOff", courses: ["CO2007"] })).toBe("Days and half-days off: CO2007");
    expect(en("results.violation", { item: "freeSeats", courses: ["CO2007", "CO2011"] })).toBe("Seats left: CO2007 and CO2011");
    expect(en("prefs.partsOff.label")).toBe("Days and half-days off");
    expect(en("prefs.freeSeats.label")).toBe("Seats left");
    expect(en("prefs.block.program")).toBe("Study program");
  });

  it("agrees nouns with numbers: credits, periods, weeks, options, seconds", () => {
    expect(en("courses.credits", { n: 1 })).toBe("1 credit");
    expect(en("courses.credits", { n: 3 })).toBe("3 credits");
    expect(en("courses.credits", { n: 2.5 })).toBe("2.5 credits");
    expect(en("courses.totalCredits", { n: 1 })).toBe("Total: 1 credit");
    expect(en("courses.totalCredits", { n: 10.5 })).toBe("Total: 10.5 credits");
    expect(en("courses.totalCreditsPartial", { n: 9, m: 1 })).toBe("Total: 9 credits (not counting 1 course)");
    expect(en("courses.totalCreditsPartial", { n: 1, m: 2 })).toBe("Total: 1 credit (not counting 2 courses)");
    expect(en("courses.periods", { periods: [3] })).toBe("Period 3");
    expect(en("courses.periods", { periods: [8, 9] })).toBe("Periods 8–9");
    expect(en("courses.weeks", { weeks: [5] })).toBe("Week 5");
    expect(en("courses.weeks", { weeks: [1, 2, 3, 4, 5, 6, 7, 9, 10] })).toBe("Weeks 1–7, 9–10");
    expect(en("prefs.topK", { n: 1 })).toBe("Show 1 option");
    expect(en("prefs.topK", { n: 5 })).toBe("Show 5 options");
    expect(en("results.stats", { ms: 40 })).toBe("Searched in under 1 second");
    expect(en("results.stats", { ms: 1010 })).toBe("Searched in 1 second");
    expect(en("results.stats", { ms: 2340 })).toBe("Searched in 2.3 seconds");
  });

  it("agrees the program sentences with how many programs there are", () => {
    expect(en("results.noProgram", { course: "CO2007", program: "L" })).toBe("Course CO2007 has no group left in program L.");
    expect(en("results.noProgramWhy", { available: ["A"] })).toBe("This course only has groups in program A.");
    expect(en("results.noProgramWhy", { available: ["A", "CC"] })).toBe("This course only has groups in programs A and CC.");
    expect(en("results.noProgramWhy", { available: ["A", "CC", "TN"] })).toBe("This course only has groups in programs A, CC, and TN.");
  });

  it("joins alternatives with commas, since they are 'either one'", () => {
    expect(en("results.alternatives", { list: ["A03_A03", "A05_A05"] })).toBe("Also works: A03_A03, A05_A05");
  });

  it("states the preferred-items switch and the mode names in the form the screen shows", () => {
    expect(en("prefs.mode.preferred")).toBe("Preferred");
    expect(en("prefs.mode.required")).toBe("Required");
    expect(en("prefs.preferredSwitch.paused")).toBe("Temporarily off (was: Preferred)");
    expect(en("prefs.preferredSwitch.disabledTip")).toBe(
      "The Count “Preferred” items switch is off, so items set to Preferred have no effect. Turn it back on to use them.",
    );
  });

  it("avoids the word 'Preferred' for the time-of-day question, which is not a mode", () => {
    for (const key of ["prefs.timeOfDay.label", "prefs.timeOfDay.low", "prefs.timeOfDay.high", "prefs.timeOfDay.tip"] as UiKey[]) {
      expect(en(key), key).not.toMatch(/preferred/i);
    }
  });
});

describe("English messages for codes", () => {
  const en = msg("en");
  const base = { day: 2, maxWeek: 30, periods: 16, room: "A4-409", count: 3, session: 1 };

  it("agrees column counts and week lists with their number", () => {
    expect(en("parse", "period-column-count", { expected: 16, found: 1 })).toMatch(/^The periods section has 1 column instead of 16\./);
    expect(en("parse", "period-column-count", { expected: 16, found: 15 })).toMatch(/^The periods section has 15 columns instead of 16\./);
    expect(en("parse", "week-digit-mismatch", { weeks: [10] })).toMatch(/^The week pattern has a digit that does not match week 10;/);
    expect(en("parse", "week-digit-mismatch", { weeks: [10, 11, 12, 14] })).toMatch(
      /^The week pattern has digits that do not match weeks 10–12, 14;/,
    );
  });

  it("says 'no campus' for an empty campus and quotes any other value", () => {
    expect(en("parse", "unknown-campus", { campus: "" })).toMatch(/^This session has no campus/);
    expect(en("parse", "unknown-campus", { campus: "3" })).toMatch(/^Campus “3” is not 1 or 2/);
  });

  it("names the session by day, periods and room, with the noun agreeing, and tells periods from weeks", () => {
    expect(en("timing", "slots-out-of-range", { ...base, sessionPeriods: [16, 17] })).toMatch(
      /^The session \(Monday, periods 16–17, room A4-409\) includes periods outside 1–16;/,
    );
    expect(en("timing", "slots-out-of-range", { ...base, sessionPeriods: [17] })).toMatch(
      /^The session \(Monday, period 17, room A4-409\) includes periods outside 1–16;/,
    );
    expect(en("timing", "slots-out-of-range", { ...base, sessionPeriods: [2, 3, 4] })).toMatch(
      /^The session \(Monday, periods 2–4, room A4-409\) includes weeks after week 30;/,
    );
    expect(
      en("timing", "internal-overlap", { session: 2, other: 1, day: 4, sessionPeriods: [10, 11, 12], room: "C6-102" }, { groupId: "A01_A01" }),
    ).toMatch(/^The session \(Wednesday, periods 10–12, room C6-102\) overlaps another session of the same group, A01_A01\./);
  });

  it("does not show the number of dropped cells", () => {
    expect(en("timing", "slots-out-of-range", { ...base, count: 777, sessionPeriods: [2, 3, 17] })).not.toContain("777");
  });

  it("agrees the dropped-conflicting count", () => {
    expect(en("solver", "dropped-conflicting", { count: 1 })).toMatch(/^1 schedule was dropped /);
    expect(en("solver", "dropped-conflicting", { count: 3 })).toMatch(/^3 schedules were dropped /);
  });

  it("quotes each constraint label, so a label with 'and' in it cannot blur the list", () => {
    expect(en("solver", "course-blocked", { course: "SK2001", constraints: ["partsOff", "freeSeats"] })).toBe(
      "No group of course SK2001 meets “Days and half-days off” and “Seats left” (set to Required). Relax your choices, or switch to Preferred.",
    );
  });

  it("agrees relaxed with how many constraints were relaxed", () => {
    expect(en("solver", "relaxed", { weight: 1000, constraints: ["freeSeats"] })).toBe(
      "No schedule meets “Seats left”, so the options below may break it. Where it is broken is marked on each option.",
    );
    expect(en("solver", "relaxed", { weight: 1000, constraints: ["partsOff", "freeSeats"] })).toBe(
      "No schedule meets all of “Days and half-days off” and “Seats left”, so the options below may break them. Where they are broken is marked on each option.",
    );
  });

  it("only advises switching the constraints the student set themselves", () => {
    expect(en("solver", "course-blocked-combined", { course: "SK2001", constraints: ["programs", "partsOff"] })).toBe(
      "No group of course SK2001 meets “Study program” and “Days and half-days off” at the same time. Switch “Days and half-days off” to Preferred.",
    );
    expect(en("solver", "no-combination-required", { constraints: ["programs"] })).toBe(
      "The groups in your study program cannot be combined into any schedule without time clashes. Try dropping a course.",
    );
  });

  it("gives all-excluded its own sentence for a course with a single group", () => {
    expect(en("solver", "all-excluded", { course: "CO2007", count: 1 })).toBe(
      "Course CO2007 has only one group, and you chose “Don’t take this group” for it. Remove that choice, or uncheck “Include this course”.",
    );
    expect(en("solver", "all-excluded", { course: "CO2007", count: 5 })).toMatch(
      /^You chose “Don’t take this group” for all 5 groups of course CO2007\./,
    );
  });

  it("agrees conflicts-with-locked with one or several locked groups", () => {
    expect(en("solver", "conflicts-with-locked", { course: "CO2011", locked: ["CO2007:L01_L01"] })).toBe(
      "Every group of course CO2011 clashes in time with the group you chose “Take only this group” for: L01_L01 (CO2007). Remove that choice, or uncheck “Include this course” for course CO2011.",
    );
    expect(en("solver", "conflicts-with-locked", { course: "CO2011", locked: ["CO2007:L01_L01", "CO2003:L02_L03"] })).toMatch(
      /clashes in time with at least one of the groups you chose “Take only this group” for: L01_L01 \(CO2007\) and L02_L03 \(CO2003\)\./,
    );
  });

  it("has two whole sentences for no-combination, chosen by afterRelax", () => {
    expect(en("solver", "no-combination", { afterRelax: true })).toContain("even if the Required items are allowed to be broken");
  });

  it("rebuilds locked-overlap from day names and period and week runs, with the nouns agreeing", () => {
    const params = {
      a: "CO2007:A01_A01",
      b: "CO2011:L01",
      overlap: [
        { day: 2, periods: [2, 3], weeks: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16] },
        { day: 8, periods: [8, 9, 10], weeks: [6, 10, 12, 14] },
      ],
    };
    expect(en("solver", "locked-overlap", params)).toBe(
      "The two groups you chose “Take only this group” for clash in time: A01_A01 (CO2007) and L01 (CO2011), on Monday, periods 2–3 (weeks 1–7, 9–16); Sunday, periods 8–10 (weeks 6, 10, 12, 14). Remove the choice from one of the two groups.",
    );
    expect(en("solver", "locked-overlap", { ...params, overlap: [{ day: 4, periods: [5], weeks: [9] }] })).toContain("Wednesday, period 5 (week 9)");
    expect(en("solver", "locked-overlap", { a: "CO2007:A01_A01", b: "CO2011:L01" })).not.toMatch(BAD_OUTPUT);
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseText, PARSE_WARNING_CODES } from "../src/lib/parser";
import type { Course, Group, ParseWarning } from "../src/lib/parser";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Reads a real fixture copied from the registration page. */
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const CO2007 = fixture("CO2007.txt");
const CO2011 = fixture("CO2011.txt");

/** Every warning the tests below produce; the last test checks that each has a code. */
const emitted: ParseWarning[] = [];
function parse(text: string) {
  const result = parseText(text);
  emitted.push(...result.warnings);
  return result;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Weekly theory: weeks 1..16 except week 8. */
const THEORY_WEEKS = [...range(1, 7), ...range(9, 16)];
/** The two alternating lab patterns found in CO2007. */
const LAB_WEEKS_A = [6, 10, 12, 14];
const LAB_WEEKS_B = [7, 9, 11, 13];

/** A line that matches no known line type. */
const GARBAGE = "#### not part of the timetable ####";

function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Applies `edit` to the 1-based line `lineNo`. */
function editLine(text: string, lineNo: number, edit: (line: string) => string): string {
  const lines = linesOf(text);
  lines[lineNo - 1] = edit(lines[lineNo - 1]);
  return lines.join("\n");
}

/** Inserts `content` so that it becomes the 1-based line `lineNo`. */
function insertLine(text: string, lineNo: number, content: string): string {
  const lines = linesOf(text);
  lines.splice(lineNo - 1, 0, content);
  return lines.join("\n");
}

/** Simulates a paste where every tab was collapsed to a single space. */
function collapseTabs(text: string): string {
  return text.replace(/\t/g, " ");
}

const LAYOUTS = [
  { name: "tab-separated", apply: (text: string) => text },
  { name: "tabs collapsed to spaces", apply: collapseTabs },
];

function onlyCourse(text: string): Course {
  const { courses } = parse(text);
  expect(courses).toHaveLength(1);
  return courses[0];
}

function groupOf(course: Course, id: string): Group {
  const group = course.groups.find((g) => g.id === id);
  if (!group) throw new Error(`group ${id} not found`);
  return group;
}

// ---------------------------------------------------------------------------
// CO2007: course with practice/lab groups
// ---------------------------------------------------------------------------

describe("CO2007 fixture (theory + lab groups)", () => {
  const result = parse(CO2007);
  const course = result.courses[0];

  it("parses one course with code, name and credits", () => {
    expect(result.courses).toHaveLength(1);
    expect(course.code).toBe("CO2007");
    expect(course.name).toBe("Kiến trúc máy tính");
    expect(course.credits).toBe(4);
  });

  it("parses exactly 18 groups in order", () => {
    expect(course.groups.map((g) => g.id)).toEqual([
      "A01_A01", "A01_A02", "CC01_CC01", "CC01_CC02", "CC02_CC03", "CC02_CC04",
      "CC03_CC05", "CC03_CC06", "CC04_CC07", "L01_L01", "L01_L02", "L02_L03",
      "L02_L04", "L03_L05", "L03_L06", "L04_L07", "L04_L08", "TN01_TN01",
    ]);
  });

  it("parses A01_A01 completely", () => {
    expect(groupOf(course, "A01_A01")).toEqual({
      id: "A01_A01",
      theoryGroup: "A01",
      practiceGroup: "A01",
      registered: 34,
      capacity: 40,
      language: "V",
      lecturer: null,
      labLecturer: null,
      theoryClassSize: 80,
      sessions: [
        { day: 2, periods: [2, 3, 4], room: "A4-409", campus: 1, labField: null, weeks: THEORY_WEEKS, kind: "theory" },
        { day: 2, periods: [8, 9, 10, 11, 12], room: "C5-202", campus: 1, labField: null, weeks: LAB_WEEKS_A, kind: "lab" },
      ],
    });
  });

  it("parses CC01_CC01 (English-taught)", () => {
    const group = groupOf(course, "CC01_CC01");
    expect(group).toMatchObject({ registered: 39, capacity: 40, language: "TA" });
    expect(group.sessions).toEqual([
      { day: 2, periods: [8, 9, 10, 11, 12], room: "C5-202", campus: 1, labField: null, weeks: LAB_WEEKS_B, kind: "lab" },
      { day: 5, periods: [8, 9, 10], room: "C5-502", campus: 1, labField: null, weeks: THEORY_WEEKS, kind: "theory" },
    ]);
  });

  it("parses a full group (CC02_CC03)", () => {
    expect(groupOf(course, "CC02_CC03")).toMatchObject({ registered: 40, capacity: 40 });
  });

  it("parses CC04_CC07: quoted 'Chưa/Đang phân công' lecturers and a Sunday lab", () => {
    const group = groupOf(course, "CC04_CC07");
    expect(group).toMatchObject({
      registered: 35,
      capacity: 40,
      lecturer: null,
      labLecturer: null,
      theoryClassSize: 40,
    });
    expect(group.sessions).toHaveLength(2);
    expect(group.sessions[0]).toMatchObject({ day: 2, periods: [7, 8, 9], room: "B10-207", campus: 1, kind: "theory" });
    expect(group.sessions[1]).toMatchObject({
      day: 8,
      periods: [2, 3, 4, 5, 6],
      room: "C5-202",
      campus: 1,
      weeks: LAB_WEEKS_A,
      kind: "lab",
    });
  });

  it("parses L01_L01 on campus 2", () => {
    const group = groupOf(course, "L01_L01");
    expect(group.registered).toBe(32);
    expect(group.sessions[0]).toMatchObject({ day: 3, periods: [10, 11, 12], room: "H6-506", campus: 2, kind: "theory" });
  });

  it("parses L03_L05 with lab and theory on the same day", () => {
    const [lab, theory] = groupOf(course, "L03_L05").sessions;
    expect(lab).toMatchObject({ day: 4, periods: [2, 3, 4, 5, 6], room: "H6-702", kind: "lab" });
    expect(theory).toMatchObject({ day: 4, periods: [10, 11, 12], room: "H6-210", kind: "theory" });
  });

  it("parses TN01_TN01 (capacity 41, class size 40)", () => {
    expect(groupOf(course, "TN01_TN01")).toMatchObject({ registered: 41, capacity: 41, theoryClassSize: 40 });
  });

  it("labels every session by its weeks pattern", () => {
    const sessions = course.groups.flatMap((g) => g.sessions);
    for (const session of sessions) {
      if (session.kind === "lab") expect([LAB_WEEKS_A, LAB_WEEKS_B]).toContainEqual(session.weeks);
      else expect(session.weeks).toEqual(THEORY_WEEKS);
    }
    // Both directions: the three patterns in this fixture map to the expected kind.
    expect(sessions.filter((s) => s.kind === "lab")).toHaveLength(18);
    expect(sessions.filter((s) => s.kind === "theory")).toHaveLength(18);
  });

  it("gives every group exactly 2 sessions", () => {
    for (const group of course.groups) expect(group.sessions, group.id).toHaveLength(2);
  });

  it("produces no warnings", () => {
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CO2011: course without practice groups
// ---------------------------------------------------------------------------

describe("CO2011 fixture (theory-only groups)", () => {
  const result = parse(CO2011);
  const course = result.courses[0];

  it("parses one course with code, name and credits", () => {
    expect(result.courses).toHaveLength(1);
    expect(course.code).toBe("CO2011");
    expect(course.name).toBe("Mô hình hóa toán học");
    expect(course.credits).toBe(3);
  });

  it("parses exactly 10 groups in order", () => {
    expect(course.groups.map((g) => g.id)).toEqual([
      "A01", "CC01", "CC02", "CC03", "CC04", "CC05", "L01", "L02", "L03", "TN01",
    ]);
  });

  it("gives every group no practice group and one weekly theory session", () => {
    for (const group of course.groups) {
      expect(group.id).not.toContain("_");
      expect(group.theoryGroup).toBe(group.id);
      expect(group.practiceGroup).toBeNull();
      expect(group.labLecturer).toBeNull();
      expect(group.sessions).toHaveLength(1);
      expect(group.sessions[0]).toMatchObject({ kind: "theory", weeks: THEORY_WEEKS });
    }
  });

  it("parses A01 completely", () => {
    expect(groupOf(course, "A01")).toEqual({
      id: "A01",
      theoryGroup: "A01",
      practiceGroup: null,
      registered: 72,
      capacity: 80,
      language: "V",
      lecturer: null,
      labLecturer: null,
      theoryClassSize: 80,
      sessions: [
        { day: 6, periods: [5, 6], room: "B1-212", campus: 1, labField: null, weeks: THEORY_WEEKS, kind: "theory" },
      ],
    });
  });

  it("parses CC01 (English-taught)", () => {
    const group = groupOf(course, "CC01");
    expect(group).toMatchObject({ registered: 37, capacity: 80, language: "TA" });
    expect(group.sessions[0]).toMatchObject({ day: 6, periods: [2, 3], room: "C5-502", campus: 1 });
  });

  it("parses a full group (CC05)", () => {
    const group = groupOf(course, "CC05");
    expect(group).toMatchObject({ registered: 80, capacity: 80 });
    expect(group.sessions[0]).toMatchObject({ day: 6, periods: [8, 9] });
  });

  it("parses L01 on campus 2 with class size 120", () => {
    const group = groupOf(course, "L01");
    expect(group).toMatchObject({ registered: 105, capacity: 120, theoryClassSize: 120 });
    expect(group.sessions[0]).toMatchObject({ day: 2, periods: [2, 3], room: "H1-210", campus: 2 });
  });

  it("parses TN01", () => {
    expect(groupOf(course, "TN01").sessions[0]).toMatchObject({ day: 3, periods: [2, 3], room: "B8-304", campus: 1 });
  });

  it("produces no warnings", () => {
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases derived from the fixtures
// ---------------------------------------------------------------------------

describe("derived edge cases", () => {
  it("parses two fixtures pasted back-to-back", () => {
    const result = parse(`${CO2007}\n${CO2011}`);
    expect(result.warnings).toEqual([]);
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0]).toEqual(parse(CO2007).courses[0]);
    expect(result.courses[1]).toEqual(parse(CO2011).courses[0]);
  });

  it.each([["CO2007", CO2007], ["CO2011", CO2011]])("parses %s the same with tabs collapsed to spaces", (_, text) => {
    const collapsed = collapseTabs(text);
    expect(collapsed).not.toContain("\t");
    const result = parse(collapsed);
    expect(result.warnings).toEqual([]);
    expect(result.courses).toEqual(parse(text).courses);
  });

  it.each([
    ["LF only", (text: string) => text.replace(/\r\n/g, "\n")],
    ["CR only", (text: string) => text.replace(/\r\n/g, "\r")],
    ["CRLF with extra blank lines", (text: string) => `\r\n\r\n${linesOf(text).join("\r\n\r\n   \r\n")}\r\n\r\n`],
  ])("parses the same with %s", (_, transform) => {
    for (const text of [CO2007, CO2011]) {
      const result = parse(transform(text));
      expect(result.warnings).toEqual([]);
      expect(result.courses).toEqual(parse(text).courses);
    }
  });

  it("skips a garbage line with one warning at the right line number", () => {
    // Line 11 falls between A01_A02's session header and its first session.
    const result = parse(insertLine(CO2007, 11, GARBAGE));
    expect(result.courses).toEqual(parse(CO2007).courses);
    expect(result.warnings).toEqual([{ line: 11, text: GARBAGE, message: expect.any(String), code: "unrecognized-line", params: {} }]);
  });

  it("counts blank lines in warning line numbers", () => {
    const result = parse(`\r\n\r\n${insertLine(CO2007, 11, GARBAGE)}`);
    expect(result.courses).toEqual(parse(CO2007).courses);
    expect(result.warnings).toEqual([{ line: 13, text: GARBAGE, message: expect.any(String), code: "unrecognized-line", params: {} }]);
  });

  describe("session line without a room", () => {
    // Line 7 is A01_A01's theory session in room A4-409.
    const variants = [
      { name: "room cell emptied", text: editLine(CO2007, 7, (line) => line.replace("A4-409", "")) },
      { name: "room cell removed", text: editLine(CO2007, 7, (line) => line.replace("\tA4-409", "")) },
      { name: "tabs collapsed", text: collapseTabs(editLine(CO2007, 7, (line) => line.replace("A4-409", ""))) },
    ];

    it.each(variants)("skips the session with one warning ($name)", ({ text }) => {
      const result = parse(text);
      const group = groupOf(result.courses[0], "A01_A01");
      expect(group.sessions).toEqual([groupOf(parse(CO2007).courses[0], "A01_A01").sessions[1]]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatchObject({ line: 7, message: expect.stringContaining("room") });
      // Other groups are untouched.
      expect(result.courses[0].groups.slice(1)).toEqual(parse(CO2007).courses[0].groups.slice(1));
    });
  });

  it("returns an empty result for empty input", () => {
    expect(parse("")).toEqual({ courses: [], warnings: [] });
    expect(parse(" \r\n\t\n ")).toEqual({ courses: [], warnings: [] });
  });

  describe.each(LAYOUTS)("lecturer names ($name)", ({ apply }) => {
    it("extracts quoted lecturer names around group codes", () => {
      // CC04_CC07 is line 37; its two quoted lecturer cells become names.
      const text = editLine(CO2007, 37, (line) =>
        line.replace("Chưa/Đang phân công", "Nguyễn Văn A").replace("Chưa/Đang phân công", "Trần Thị B"),
      );
      const result = parse(apply(text));
      expect(result.warnings).toEqual([]);
      expect(groupOf(result.courses[0], "CC04_CC07")).toMatchObject({
        theoryGroup: "CC04",
        practiceGroup: "CC07",
        lecturer: "Nguyễn Văn A",
        labLecturer: "Trần Thị B",
        theoryClassSize: 40,
      });
    });

    it("extracts the lecturer of a theory-only group", () => {
      // CO2011 line 5 is A01; cell 4 is the (empty) lecturer column.
      const text = editLine(CO2011, 5, (line) => {
        const cells = line.split("\t");
        cells[4] = "Nguyễn Văn A";
        return cells.join("\t");
      });
      const result = parse(apply(text));
      expect(result.warnings).toEqual([]);
      expect(groupOf(result.courses[0], "A01")).toMatchObject({
        lecturer: "Nguyễn Văn A",
        labLecturer: null,
        theoryClassSize: 80,
      });
    });
  });

  it.each(LAYOUTS)("reads credits when the course name ends in a number ($name)", ({ apply }) => {
    const course = onlyCourse(apply(CO2007.replaceAll("Kiến trúc máy tính", "Kiến trúc máy tính 2")));
    expect(course.name).toBe("Kiến trúc máy tính 2");
    expect(course.credits).toBe(4);
  });

  it("attaches credits from a summary row placed after the course", () => {
    const lines = linesOf(CO2007);
    const result = parse([...lines.slice(2), ...lines.slice(0, 2)].join("\n"));
    expect(result.warnings).toEqual([]);
    expect(result.courses[0].credits).toBe(4);
  });

  it("sets credits to null without a summary row", () => {
    const result = parse(linesOf(CO2011).slice(2).join("\n"));
    expect(result.warnings).toEqual([]);
    expect(result.courses[0].credits).toBeNull();
    expect(result.courses[0].groups).toEqual(parse(CO2011).courses[0].groups);
  });

  it("uses the week position when a weeks digit is wrong, with a warning", () => {
    // Week 10 should be "0"; make it "9".
    const text = editLine(CO2007, 7, (line) => line.replace("1234567-90123456", "1234567-99123456"));
    const result = parse(text);
    expect(groupOf(result.courses[0], "A01_A01").sessions[0].weeks).toEqual(THEORY_WEEKS);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ line: 7, message: expect.stringContaining("week 10") });
  });

  it("warns on a group line before any course and on its orphan sessions", () => {
    // Lines 4-8 of CO2007: group-table header, A01_A01, session header, 2 sessions.
    const result = parse(linesOf(CO2007).slice(3, 8).join("\n"));
    expect(result.courses).toEqual([]);
    expect(result.warnings.map((w) => w.line)).toEqual([2, 4, 5]);
  });

  it("warns on a session line directly under a course header", () => {
    const lines = linesOf(CO2007);
    // Course header (line 3) followed by A01_A01's first session (line 7).
    const result = parse([lines[2], lines[6]].join("\n"));
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].groups).toEqual([]);
    expect(result.warnings).toEqual([{ line: 2, text: lines[6].trim(), message: expect.any(String), code: "session-without-group", params: {} }]);
  });

  it("never throws on truncated or non-string input", () => {
    for (const text of [CO2007, collapseTabs(CO2011)]) {
      for (let cut = 0; cut <= text.length; cut += 7) {
        expect(() => parse(text.slice(0, cut))).not.toThrow();
      }
    }
    expect(parse(undefined as unknown as string)).toEqual({ courses: [], warnings: [] });
  });
});

// ---------------------------------------------------------------------------
// Rooms whose number part has letters (real data: SP1031)
// ---------------------------------------------------------------------------

describe("rooms with letters (SP1031)", () => {
  it("keeps sessions in rooms like C5-HOITRUONG and H1-GDH1", () => {
    const result = parse(fixture("SP1031.txt"));
    expect(result.warnings).toEqual([]);
    const [course] = result.courses;
    expect(course.groups).toHaveLength(21);
    expect(course.groups.every((g) => g.sessions.length === 1)).toBe(true);
    const room = (id: string) => course.groups.find((g) => g.id === id)!.sessions[0];
    expect(room("CC03")).toMatchObject({ day: 5, periods: [9, 10], room: "C5-HOITRUONG", campus: 1 });
    expect(room("L01")).toMatchObject({ day: 4, periods: [2, 3], room: "H1-GDH1", campus: 2 });
    expect(room("L02")).toMatchObject({ day: 5, periods: [4, 5], room: "H6-GDH6", campus: 2 });
  });
});

// ---------------------------------------------------------------------------
// Warning codes (runs last: checks every warning produced above)
// ---------------------------------------------------------------------------

describe("warning codes", () => {
  it("every warning emitted by the tests above has a known code and params", () => {
    expect(emitted.length).toBeGreaterThan(10);
    for (const warning of emitted) {
      expect(PARSE_WARNING_CODES, warning.message).toContain(warning.code);
      expect(warning.params).toBeTypeOf("object");
    }
  });

  it("every real fixture parses without warnings", () => {
    for (const name of ["CO2001.txt", "CO2003.txt", "CO2007.txt", "CO2011.txt", "SK2001.txt", "SP1031.txt"]) {
      expect(parseText(fixture(name)).warnings, name).toEqual([]);
    }
  });
});

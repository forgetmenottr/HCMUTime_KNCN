import type { Course, Day, Group, ParseResult, ParseWarning, ParseWarningCode, Session } from "./types";

// ---------------------------------------------------------------------------
// Patterns. Vietnamese text is matched after NFC normalization; `\b` is avoided
// because JS treats letters like "ứ" as non-word characters.
// ---------------------------------------------------------------------------

/** Summary row: "1  CO2007  Kiến trúc máy tính  4.0  [BB/TC]". The optional
 *  trailing column must not start with a digit, so a name ending in a number
 *  ("Giải tích 1  4.0") is not mistaken for the credits. */
const SUMMARY_ROW = /^\d+\s+([A-Z]{2}\d{4})\s+(.+?)\s+(\d+(?:\.\d+)?)(?:\s+[^\d\s]\S*)?$/;
/** Course header: "CO2007 - Kiến trúc máy tính". */
const COURSE_HEADER = /^([A-Z]{2}\d{4})\s+-\s+(.+)$/;
/** Group id: "A01_A01" (theory_practice) or "A01" (theory only). */
const GROUP_ID = /^([A-Z]{1,4}\d{2})(?:_([A-Z]{1,4}\d{2}))?$/;
/** A single group code; used to tell lecturer text apart from group columns. */
const GROUP_CODE = /^[A-Z]{1,4}\d{2}$/;
/** Registered/capacity: "34/40". */
const REG_CAP = /^(\d+)\/(\d+)$/;
const INTEGER = /^\d+$/;
/** Session day prefix: "Thứ 2".."Thứ 7" or "Chủ nhật". */
const DAY_PREFIX = /^(?:Thứ\s*([2-7])|Chủ\s*nhật)(?=\s|$)/;
/** One cell of the periods column: "-" or a period number. */
const PERIOD_TOKEN = /^(?:-|\d{1,2})$/;
/** Room code: "C5-202", "B10-207", "C5-HOITRUONG", "H1-GDH1". There are no online classes. */
const ROOM = /^[A-Z]\d{1,2}-[A-Z0-9]+$/;
const CAMPUS = /^[12]$/;
/** Weeks string: digits and "-" only, e.g. "1234567-90123456-----". */
const WEEKS = /^[\d-]+$/;
/** Placeholder lecturer text meaning "not assigned yet". */
const UNASSIGNED_LECTURER = /^(?:chưa|đang)(?:\s*\/\s*(?:chưa|đang))?\s+phân\s+công$/i;

/** Number of cells in the periods column (tiết 1..16). */
const PERIOD_COLUMNS = 16;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Mutable state carried from one line to the next. */
interface ParserState {
  courses: Course[];
  warnings: ParseWarning[];
  /** Credits from summary rows, keyed by course code. */
  credits: Map<string, number>;
  course: Course | null;
  group: Group | null;
}

/** A problem found on one line: code + params for the UI, plus the English text. */
interface Issue {
  code: ParseWarningCode;
  params: Record<string, unknown>;
  message: string;
}

function issue(code: ParseWarningCode, message: string, params: Record<string, unknown> = {}): Issue {
  return { code, params, message };
}

/** Result of parsing one line: a value plus non-fatal notes, or a fatal error. */
type LineResult<T> = { ok: true; value: T; notes: Issue[] } | { ok: false; error: Issue };

/** Group-line columns whose position depends on the layout (tabs vs. spaces). */
interface GroupColumns {
  registered: number;
  capacity: number;
  language: string;
  lecturer: string;
  labLecturer: string;
}

/** Raw text fields of a session line, before validation. */
interface SessionFields {
  periodTokens: string[];
  room: string;
  campus: string;
  labField: string;
  weeks: string;
}

/** Decoded numbers plus non-fatal notes. */
interface Decoded {
  values: number[];
  notes: Issue[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses text copied from the HCMUT registration page.
 * Never throws: malformed lines are skipped and reported in `warnings`.
 */
export function parse(text: string): ParseResult {
  const state: ParserState = { courses: [], warnings: [], credits: new Map(), course: null, group: null };
  const source = typeof text === "string" ? text.normalize("NFC") : "";

  source.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = cleanLine(raw);
    if (line === "") return;
    try {
      handleLine(state, line, index + 1);
    } catch (error) {
      // Last-resort guard so a parser bug never breaks the caller.
      warn(state, index + 1, line, issue("internal-error", `internal parser error: ${String(error)}`, { error: String(error) }));
    }
  });

  attachCredits(state);
  return { courses: state.courses, warnings: state.warnings };
}

/** Trims a line and turns non-breaking spaces (common in HTML copies) into spaces. */
function cleanLine(raw: string): string {
  return raw.replace(/ /g, " ").replace(/[​﻿]/g, "").trim();
}

/** Classifies a non-blank line and dispatches it. */
function handleLine(state: ParserState, line: string, lineNo: number): void {
  if (isTableHeader(line)) return;

  const summary = SUMMARY_ROW.exec(line);
  if (summary) {
    state.credits.set(summary[1], Number(summary[3]));
    return;
  }

  const header = COURSE_HEADER.exec(line);
  if (header) {
    startCourse(state, header[1], header[2].trim());
    return;
  }

  if (DAY_PREFIX.test(line)) {
    handleSessionLine(state, line, lineNo);
  } else if (GROUP_ID.test(firstToken(line))) {
    handleGroupLine(state, line, lineNo);
  } else {
    warn(state, lineNo, line, issue("unrecognized-line", "unrecognized line; skipped"));
  }
}

/** True for the three table headers (summary, groups, sessions), which carry no data. */
function isTableHeader(line: string): boolean {
  const summaryHeader = line.startsWith("STT") && /Mã\s+MH/.test(line);
  const groupHeader = /^Nhóm\s+lớp/.test(line);
  const sessionHeader = line.startsWith("Thứ") && line.includes("Tiết");
  return summaryHeader || groupHeader || sessionHeader;
}

function firstToken(line: string): string {
  return line.split(/\s+/)[0];
}

function warn(state: ParserState, line: number, text: string, found: Issue): void {
  state.warnings.push({ line, text, message: found.message, code: found.code, params: found.params });
}

/** Opens a new course; later group lines belong to it. */
function startCourse(state: ParserState, code: string, name: string): void {
  const course: Course = { code, name, credits: null, groups: [] };
  state.courses.push(course);
  state.course = course;
  state.group = null;
}

/** Fills in credits from summary rows (they may appear before or after the header). */
function attachCredits(state: ParserState): void {
  for (const course of state.courses) {
    course.credits = state.credits.get(course.code) ?? null;
  }
}

/** Parses a group line and makes it the current group. */
function handleGroupLine(state: ParserState, line: string, lineNo: number): void {
  // Reset first so sessions under a rejected group never attach to the previous one.
  state.group = null;
  if (!state.course) {
    warn(state, lineNo, line, issue("group-before-course", "group line before any course header; skipped"));
    return;
  }
  const result = parseGroupLine(line);
  if (!result.ok) {
    warn(state, lineNo, line, result.error);
    return;
  }
  result.notes.forEach((note) => warn(state, lineNo, line, note));
  state.course.groups.push(result.value);
  state.group = result.value;
}

/** Parses a session line and attaches it to the current group. */
function handleSessionLine(state: ParserState, line: string, lineNo: number): void {
  if (!state.group) {
    warn(state, lineNo, line, issue("session-without-group", "session line without a valid group above it; skipped"));
    return;
  }
  const result = parseSessionLine(line);
  if (!result.ok) {
    warn(state, lineNo, line, result.error);
    return;
  }
  result.notes.forEach((note) => warn(state, lineNo, line, note));
  state.group.sessions.push(result.value);
}

// ---------------------------------------------------------------------------
// Group lines
//   A01_A01 | 34/40 | V | A01 | [lecturer] | A01 | [lab lecturer] | 80 | [#]
//   A01     | 72/80 | V | A01 | [lecturer] |     |                | 80 | [#]
// ---------------------------------------------------------------------------

function parseGroupLine(line: string): LineResult<Group> {
  const tokens = line.split(/\s+/);
  const id = GROUP_ID.exec(tokens[0]);
  if (!id) return { ok: false, error: issue("invalid-group-id", `invalid group id "${tokens[0]}"; skipped`, { id: tokens[0] }) };
  const theoryGroup = id[1];
  const practiceGroup = id[2] ?? null;

  const columns =
    (line.includes("\t") ? groupColumnsFromCells(line, theoryGroup, practiceGroup) : null) ??
    groupColumnsFromTokens(tokens);
  if (!columns) {
    return { ok: false, error: issue("missing-registered-capacity", "group line has no registered/capacity (e.g. 34/40); skipped") };
  }

  return {
    ok: true,
    notes: columns.language ? [] : [issue("missing-language", "group line has no language (V/TA)")],
    value: {
      id: id[0],
      theoryGroup,
      practiceGroup,
      registered: columns.registered,
      capacity: columns.capacity,
      language: columns.language,
      lecturer: cleanLecturer(columns.lecturer),
      labLecturer: practiceGroup ? cleanLecturer(columns.labLecturer) : null,
      theoryClassSize: lastInteger(tokens),
      sessions: [],
    },
  };
}

/**
 * Tab layout: reads columns by position. Returns null when the cells do not
 * line up (group codes differ from the id), so the caller falls back to tokens.
 */
function groupColumnsFromCells(line: string, theoryGroup: string, practiceGroup: string | null): GroupColumns | null {
  const cells = line.split("\t").map((cell) => cell.trim());
  if (cells.length < 7) return null;
  const [, regCap, language, theoryCode, lecturer, practiceCode, labLecturer] = cells;
  const counts = REG_CAP.exec(regCap);
  if (!counts || theoryCode !== theoryGroup || practiceCode !== (practiceGroup ?? "")) return null;
  return { registered: Number(counts[1]), capacity: Number(counts[2]), language, lecturer, labLecturer };
}

/**
 * Space layout (tabs collapsed): anchors on "34/40" and the trailing class
 * size, then splits lecturer text at group-code tokens.
 */
function groupColumnsFromTokens(tokens: string[]): GroupColumns | null {
  const countsIndex = tokens.findIndex((token) => REG_CAP.test(token));
  if (countsIndex < 0) return null;
  const counts = REG_CAP.exec(tokens[countsIndex])!;

  // Drop the class size (last integer) and anything after it. What remains is
  // [language] [Nhóm LT] [lecturer...] [Nhóm BT] [lab lecturer...].
  let rest = tokens.slice(countsIndex + 1);
  const sizeIndex = rest.findLastIndex((token) => INTEGER.test(token));
  if (sizeIndex >= 0) rest = rest.slice(0, sizeIndex);

  const language = rest.length > 0 && !GROUP_CODE.test(rest[0]) ? rest[0] : "";
  if (language) rest = rest.slice(1);
  if (rest.length > 0 && GROUP_CODE.test(rest[0])) rest = rest.slice(1); // Nhóm LT

  const practiceIndex = rest.findIndex((token) => GROUP_CODE.test(token));
  const lecturer = practiceIndex < 0 ? rest : rest.slice(0, practiceIndex);
  const labLecturer = practiceIndex < 0 ? [] : rest.slice(practiceIndex + 1);
  return {
    registered: Number(counts[1]),
    capacity: Number(counts[2]),
    language,
    lecturer: lecturer.join(" "),
    labLecturer: labLecturer.join(" "),
  };
}

/** Strips quotes and collapses spaces; empty or "Chưa/Đang phân công" → null. */
function cleanLecturer(raw: string): string | null {
  const text = raw.trim().replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim();
  return text === "" || UNASSIGNED_LECTURER.test(text) ? null : text;
}

/** Last purely numeric token of the line (Sĩ số LT), or null. */
function lastInteger(tokens: string[]): number | null {
  const token = tokens.findLast((t) => INTEGER.test(t));
  return token === undefined ? null : Number(token);
}

// ---------------------------------------------------------------------------
// Session lines
//   Thứ 2 | - 2 3 4 - - - - - - - - - - - - | A4-409 | 1 | [BT/TN] | 1234567-90123456------
// ---------------------------------------------------------------------------

function parseSessionLine(line: string): LineResult<Session> {
  const dayMatch = DAY_PREFIX.exec(line);
  if (!dayMatch) return { ok: false, error: issue("session-no-day", "session line has no day; skipped") };
  const day = (dayMatch[1] ? Number(dayMatch[1]) : 8) as Day;

  const fields =
    (line.includes("\t") ? sessionFieldsFromCells(line) : null) ??
    sessionFieldsFromTokens(line.slice(dayMatch[0].length));
  return buildSession(day, fields);
}

/** Tab layout: reads the six columns by position; null if they do not validate. */
function sessionFieldsFromCells(line: string): SessionFields | null {
  const cells = line.split("\t").map((cell) => cell.trim());
  if (cells.length < 6) return null;
  const [, periods, room, campus, labField, weeks] = cells;
  const periodTokens = periods.split(/\s+/).filter(Boolean);
  const valid = periodTokens.every((t) => PERIOD_TOKEN.test(t)) && ROOM.test(room) && WEEKS.test(weeks);
  return valid ? { periodTokens, room, campus, labField, weeks } : null;
}

/**
 * Space layout: up to 16 period tokens after the day, then the room, and
 * campus / BT-TN / weeks read around it. Missing room or weeks are left
 * empty for `buildSession` to reject.
 */
function sessionFieldsFromTokens(afterDay: string): SessionFields {
  const tokens = afterDay.trim().split(/\s+/).filter(Boolean);
  let count = 0;
  while (count < tokens.length && count < PERIOD_COLUMNS && PERIOD_TOKEN.test(tokens[count])) count++;
  const periodTokens = tokens.slice(0, count);

  const tail = tokens.slice(count);
  const roomIndex = tail.findIndex((token) => ROOM.test(token));
  if (roomIndex < 0) return { periodTokens, room: "", campus: "", labField: "", weeks: "" };

  // After the room: [campus] [BT/TN...] [weeks]
  const afterRoom = tail.slice(roomIndex + 1);
  const campus = afterRoom.length > 0 && CAMPUS.test(afterRoom[0]) ? afterRoom[0] : "";
  const body = afterRoom.slice(campus ? 1 : 0);
  const last = body[body.length - 1];
  const weeks = last !== undefined && WEEKS.test(last) ? last : "";
  const labField = (weeks ? body.slice(0, -1) : body).join(" ");
  return { periodTokens, room: tail[roomIndex], campus, labField, weeks };
}

/** Validates raw fields and turns them into a Session. */
function buildSession(day: Day, fields: SessionFields): LineResult<Session> {
  if (!ROOM.test(fields.room)) return { ok: false, error: issue("session-no-room", "session line has no room (e.g. C5-202); skipped") };
  if (!fields.weeks) return { ok: false, error: issue("session-no-weeks", "session line has no weeks string; skipped") };
  const periods = decodePeriods(fields.periodTokens);
  if (periods.values.length === 0) return { ok: false, error: issue("session-no-periods", "session line has no periods; skipped") };

  const weeks = decodeWeeks(fields.weeks);
  const campus = parseCampus(fields.campus);
  const notes = [...periods.notes, ...weeks.notes];
  if (campus === null) notes.push(issue("unknown-campus", `missing or unknown campus "${fields.campus}"`, { campus: fields.campus }));
  if (weeks.values.length === 0) notes.push(issue("no-teaching-week", "weeks string has no teaching week"));

  return {
    ok: true,
    notes,
    value: {
      day,
      periods: periods.values,
      room: fields.room,
      campus,
      labField: fields.labField || null,
      weeks: weeks.values,
      kind: detectKind(weeks.values),
    },
  };
}

/** Collects the period numbers; notes a wrong column count or a number out of its column. */
function decodePeriods(tokens: string[]): Decoded {
  const values: number[] = [];
  let misplaced = false;
  tokens.forEach((token, index) => {
    if (token === "-") return;
    const period = Number(token);
    values.push(period);
    if (period !== index + 1) misplaced = true;
  });

  const notes: Issue[] = [];
  if (tokens.length !== PERIOD_COLUMNS) {
    notes.push(
      issue("period-column-count", `expected ${PERIOD_COLUMNS} period columns, found ${tokens.length}`, {
        expected: PERIOD_COLUMNS,
        found: tokens.length,
      }),
    );
  } else if (misplaced) {
    notes.push(issue("period-misplaced", "a period number does not match its column"));
  }
  return { values, notes };
}

/**
 * Weeks string: character i (0-based) is week i+1, "-" means no class.
 * The digit should equal week % 10; if not, the position still wins.
 */
function decodeWeeks(text: string): Decoded {
  const values: number[] = [];
  const mismatched: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "-") continue;
    const week = index + 1;
    values.push(week);
    if (Number(text[index]) !== week % 10) mismatched.push(week);
  }
  const notes = mismatched.length
    ? [issue("week-digit-mismatch", `weeks string digit does not match week ${mismatched.join(", ")}; used its position`, { weeks: mismatched })]
    : [];
  return { values, notes };
}

function parseCampus(text: string): 1 | 2 | null {
  if (text === "1") return 1;
  if (text === "2") return 2;
  return null;
}

/** Labs meet every other week, so a session with no two consecutive weeks is a lab. */
function detectKind(weeks: number[]): Session["kind"] {
  const hasConsecutive = weeks.some((week, index) => index > 0 && week === weeks[index - 1] + 1);
  return hasConsecutive ? "theory" : "lab";
}

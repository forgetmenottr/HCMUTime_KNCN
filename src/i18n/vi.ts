import type { Day } from "../lib/parser";
import type { ConstraintName } from "../lib/solver";
import type { Dictionary, HalfDay } from "./types";

/**
 * Labels for constraint names, as they appear in `violations[].item`,
 * `relaxed[]` and `params.constraints`. Each one is the name of the control the
 * student sees, so a message points at something they can find on the screen.
 */
const constraint = {
  programs: "Chương trình đào tạo",
  // Both day constraints read as the one merged control; daysOff has no control of its own.
  partsOff: "Ngày/buổi nghỉ",
  daysOff: "Ngày/buổi nghỉ",
  // The short control name, as in the list of controls (B1), not the long label "Chỉ chọn lớp còn chỗ".
  freeSeats: "Còn chỗ trống",
  // No control on the screen. These are always sent "off", so they never reach a message;
  // the labels exist so that a bug still reads sensibly (and is reported as "unexpected").
  campuses: "Cơ sở",
  language: "Ngôn ngữ giảng dạy",
  avoidLecturers: "Tránh giảng viên",
} satisfies Record<ConstraintName, string>;

/** "Thứ 2" … as in the pasted data, which students already read. */
const dayLong = {
  2: "Thứ 2",
  3: "Thứ 3",
  4: "Thứ 4",
  5: "Thứ 5",
  6: "Thứ 6",
  7: "Thứ 7",
  8: "Chủ nhật",
} satisfies Record<Day, string>;

const dayShort = {
  2: "T2",
  3: "T3",
  4: "T4",
  5: "T5",
  6: "T6",
  7: "T7",
  8: "CN",
} satisfies Record<Day, string>;

/** Rows of the "Ngày/buổi nghỉ" grid: a half-day the student wants off. */
const partOff = {
  morning: "Sáng",
  afternoon: "Chiều",
} satisfies Record<HalfDay, string>;

/**
 * Choices of "Bạn thích học buổi nào?": a half-day the student wants to study in.
 * Same words as `partOff` in Vietnamese, but a separate key so either can be
 * reworded without changing the other (the intent is opposite).
 */
const partStudy = {
  morning: "Sáng",
  afternoon: "Chiều",
} satisfies Record<HalfDay, string>;

/** Campus names; the proper names stay as they are in both languages. */
const campus = {
  1: "CS1 – Lý Thường Kiệt",
  2: "CS2 – Dĩ An",
} satisfies Record<1 | 2, string>;

/** Session kind, as the parser guesses it from the weeks (`Session.kind`). */
const kind = {
  theory: "Lý thuyết",
  lab: "Thực hành",
} satisfies Record<"theory" | "lab", string>;

/** Vietnamese (primary language). Sections are filled stage by stage; see status.ts. */
export const vi: Dictionary = {
  parse: {},
  timing: {},
  solver: {},
  constraint,
  dayLong,
  dayShort,
  partOff,
  partStudy,
  campus,
  kind,
  ui: {},
};

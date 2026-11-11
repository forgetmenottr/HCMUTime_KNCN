import type { Day } from "../lib/parser";
import type { ConstraintName } from "../lib/solver";
import type { Dictionary, HalfDay } from "./types";

/** Labels for constraint names; each is the English name of the control on the screen (see vi.ts). */
const constraint = {
  programs: "Study program",
  partsOff: "Days and half-days off",
  daysOff: "Days and half-days off",
  freeSeats: "Seats left",
  // No control on the screen; never sent "on" (see vi.ts).
  campuses: "Campus",
  language: "Teaching language",
  avoidLecturers: "Lecturers to avoid",
} satisfies Record<ConstraintName, string>;

const dayLong = {
  2: "Monday",
  3: "Tuesday",
  4: "Wednesday",
  5: "Thursday",
  6: "Friday",
  7: "Saturday",
  8: "Sunday",
} satisfies Record<Day, string>;

const dayShort = {
  2: "Mon",
  3: "Tue",
  4: "Wed",
  5: "Thu",
  6: "Fri",
  7: "Sat",
  8: "Sun",
} satisfies Record<Day, string>;

/** Rows of the days-off grid: a half-day the student wants off. */
const partOff = {
  morning: "Morning",
  afternoon: "Afternoon",
} satisfies Record<HalfDay, string>;

/** Choices of the time-of-day preference: when the student would rather study. Plural on purpose ("I prefer mornings"). */
const partStudy = {
  morning: "Mornings",
  afternoon: "Afternoons",
} satisfies Record<HalfDay, string>;

const campus = {
  1: "Campus 1 – Lý Thường Kiệt",
  2: "Campus 2 – Dĩ An",
} satisfies Record<1 | 2, string>;

const kind = {
  theory: "Theory",
  lab: "Lab",
} satisfies Record<"theory" | "lab", string>;

/** English (second language). Sections are filled stage by stage; see status.ts. */
export const en: Dictionary = {
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
  name: {},
  ui: {},
};

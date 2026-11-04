import type { Day } from "../parser";
import type { IndexedGroup } from "../timing";
import { DEFAULT_MAX_NODES, DEFAULT_TOP_K, MAX_WEIGHT } from "./constants";

export type Mode = "off" | "required" | "preferred";

/** Names of the group-level constraints, in a fixed order. */
export const CONSTRAINTS = ["programs", "campuses", "daysOff", "partsOff", "language", "freeSeats", "avoidLecturers"] as const;
export type ConstraintName = (typeof CONSTRAINTS)[number];

/** The three parts of a day (see DAY_PARTS for the periods of each). */
export const DAY_PART_NAMES = ["morning", "afternoon", "evening"] as const;
export type DayPart = (typeof DAY_PART_NAMES)[number];

/** Half a day off, e.g. { day: 2, part: "morning" } = Thứ 2 sáng. */
export interface DayPartOff {
  day: Day;
  part: DayPart;
}

export interface Preferences {
  /**
   * Program track of the group (the leading letters of its theory group; see
   * `programOf`). An EMPTY list means "not chosen yet" and filters nothing,
   * whatever the mode.
   */
  programs: { mode: Mode; allowed: string[] };
  /** Every session of the group must be on an allowed campus. */
  campuses: { mode: Mode; allowed: (1 | 2)[] };
  /** The group has no session on these days (whole days). */
  daysOff: { mode: Mode; days: Day[] };
  /** The group has no session in these half-days. An empty list filters nothing. */
  partsOff: { mode: Mode; parts: DayPartOff[] };
  /** e.g. ["V"] or ["TA"]. */
  language: { mode: Mode; allowed: string[] };
  /** registered < capacity. */
  freeSeats: { mode: Mode };
  /** Case/diacritic-insensitive match on lecturer or labLecturer. */
  avoidLecturers: { mode: Mode; names: string[] };
  /** courseCode -> groupId; ALWAYS hard, never relaxed. */
  locked: Record<string, string>;
  /** Group keys like "CO2007:A01_A01"; ALWAYS hard, never relaxed. */
  excluded: string[];
  /** Soft weights, each 0..10; 0 = ignore. */
  weights: {
    timeOfDay: { prefer: "morning" | "afternoon" | "none"; weight: number };
    fewerDays: number;
    compactDays: number;
    noCampusSwitch: number;
    avoidEarly: number;
    /** Weight applied to each constraint whose mode is "preferred". */
    preferredItems: number;
  };
  /** Number of schedules to return (default 5). */
  topK: number;
  /** Search stops after this many nodes and marks the result truncated (default 5_000_000). */
  maxNodes: number;
}

/** Defaults: no constraints, mild preference for compact, few, non-early days. Treat as read-only. */
export const DEFAULT_PREFERENCES: Preferences = {
  programs: { mode: "off", allowed: [] },
  campuses: { mode: "off", allowed: [1, 2] },
  daysOff: { mode: "off", days: [] },
  partsOff: { mode: "off", parts: [] },
  language: { mode: "off", allowed: ["V", "TA"] },
  freeSeats: { mode: "off" },
  avoidLecturers: { mode: "off", names: [] },
  locked: {},
  excluded: [],
  weights: {
    timeOfDay: { prefer: "none", weight: 0 },
    fewerDays: 5,
    compactDays: 3,
    noCampusSwitch: 5,
    avoidEarly: 3,
    preferredItems: 5,
  },
  topK: DEFAULT_TOP_K,
  maxNodes: DEFAULT_MAX_NODES,
};

export interface Pick {
  courseCode: string;
  group: IndexedGroup;
  /** Keys of equivalent groups, excluding the chosen one. */
  alternatives: string[];
}

/** One scored item; metric is in [0, 1] and penalty = weight × metric. */
export interface ScoreItem {
  item: string;
  metric: number;
  weight: number;
  penalty: number;
}

export interface Violation {
  item: string;
  courses: string[];
}

export interface Schedule {
  picks: Pick[];
  penalty: number;
  score: number;
  breakdown: ScoreItem[];
  violations: Violation[];
}

/** Every `SolverDiagnostic.code` solve() can emit. */
export const SOLVER_DIAGNOSTIC_CODES = [
  "no-courses",
  "dropped-conflicting",
  "course-blocked",
  "course-blocked-combined",
  "no-combination-required",
  "course-no-program",
  "relaxed",
  "course-no-groups",
  "all-excluded",
  "locked-excluded",
  "locked-missing",
  "locked-overlap",
  "conflicts-with-locked",
  "no-combination",
  "truncated",
] as const;
export type SolverDiagnosticCode = (typeof SOLVER_DIAGNOSTIC_CODES)[number];

/** One diagnostic: a code and its values for the UI, plus the English text. */
export interface SolverDiagnostic {
  code: string;
  params: Record<string, unknown>;
  message: string;
}

export interface SolveResult {
  status: "ok" | "relaxed" | "infeasible";
  /** Sorted: penalty asc, then picks' keys lexicographically (deterministic). */
  schedules: Schedule[];
  /** Constraint names converted from required to soft. */
  relaxed: string[];
  /** Human-readable reasons (English) when relaxed/infeasible. */
  diagnostics: string[];
  /** The same diagnostics with codes, one per `diagnostics` entry, in the same order. */
  diagnosticDetails: SolverDiagnostic[];
  stats: { nodes: number; ms: number; truncated: boolean };
}

// ---------------------------------------------------------------------------
// Normalization: preferences may come from localStorage or an older version,
// so solve() never trusts their shape.
// ---------------------------------------------------------------------------

function mode(value: unknown): Mode {
  return value === "required" || value === "preferred" ? value : "off";
}

function list<T>(value: unknown, keep: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(keep) : [];
}

function clampWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_WEIGHT, Math.max(0, value)) : 0;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

const isCampus = (x: unknown): x is 1 | 2 => x === 1 || x === 2;
const isDay = (x: unknown): x is Day => typeof x === "number" && Number.isInteger(x) && x >= 2 && x <= 8;
const isString = (x: unknown): x is string => typeof x === "string";

function isPartOff(x: unknown): x is DayPartOff {
  const item = x as Partial<DayPartOff> | null;
  return typeof item === "object" && item !== null && isDay(item.day) && DAY_PART_NAMES.includes(item.part as DayPart);
}

/** Well-formed half-days, without duplicates, ordered by day then morning → evening. */
function partsOff(value: unknown): DayPartOff[] {
  const seen = new Set<string>();
  const parts = list(value, isPartOff).filter((p) => {
    const key = `${p.day}:${p.part}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return parts
    .map((p) => ({ day: p.day, part: p.part }))
    .sort((a, b) => a.day - b.day || DAY_PART_NAMES.indexOf(a.part) - DAY_PART_NAMES.indexOf(b.part));
}

/** Returns well-formed preferences: unknown modes → "off", weights clamped to 0..10, bad lists → []. */
export function normalizePreferences(input: Preferences): Preferences {
  const p = (input && typeof input === "object" ? input : {}) as Partial<Preferences>;
  const w = (p.weights && typeof p.weights === "object" ? p.weights : {}) as Partial<Preferences["weights"]>;
  const prefer = w.timeOfDay?.prefer;
  const locked = p.locked && typeof p.locked === "object" ? p.locked : {};
  return {
    programs: { mode: mode(p.programs?.mode), allowed: list(p.programs?.allowed, isString) },
    campuses: { mode: mode(p.campuses?.mode), allowed: list(p.campuses?.allowed, isCampus) },
    daysOff: { mode: mode(p.daysOff?.mode), days: list(p.daysOff?.days, isDay) },
    partsOff: { mode: mode(p.partsOff?.mode), parts: partsOff(p.partsOff?.parts) },
    language: { mode: mode(p.language?.mode), allowed: list(p.language?.allowed, isString) },
    freeSeats: { mode: mode(p.freeSeats?.mode) },
    avoidLecturers: { mode: mode(p.avoidLecturers?.mode), names: list(p.avoidLecturers?.names, isString) },
    locked: Object.fromEntries(Object.entries(locked).filter(([, id]) => isString(id))),
    excluded: list(p.excluded, isString),
    weights: {
      timeOfDay: {
        prefer: prefer === "morning" || prefer === "afternoon" ? prefer : "none",
        weight: clampWeight(w.timeOfDay?.weight),
      },
      fewerDays: clampWeight(w.fewerDays),
      compactDays: clampWeight(w.compactDays),
      noCampusSwitch: clampWeight(w.noCampusSwitch),
      avoidEarly: clampWeight(w.avoidEarly),
      preferredItems: clampWeight(w.preferredItems),
    },
    topK: positiveInt(p.topK, DEFAULT_TOP_K),
    maxNodes: positiveInt(p.maxNodes, DEFAULT_MAX_NODES),
  };
}

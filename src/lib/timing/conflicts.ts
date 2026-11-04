import type { Day } from "../parser";
import type { IndexedGroup } from "./build";
import type { TimeMask } from "./constants";
import { intersection, intersects, slots, type Slot } from "./mask";

/** Overlapping slots that share a day and the same set of periods. */
export interface ConflictSummaryItem {
  day: Day;
  periods: number[];
  weeks: number[];
}

/** A group, or a bare mask (e.g. one session from `buildSessionMask`). */
export type Timed = IndexedGroup | TimeMask;

function maskOf(x: Timed): TimeMask {
  return x instanceof Uint32Array ? x : x.mask;
}

/**
 * Two groups conflict only if they share a day, a period AND a week, which is
 * exactly a shared bit. Alternating-week labs at the same time do not conflict.
 */
export function conflicts(a: IndexedGroup, b: IndexedGroup): boolean {
  return intersects(a.mask, b.mask);
}

/** Every overlapping slot, sorted by week, day, period. */
export function conflictSlots(a: Timed, b: Timed): Slot[] {
  return slots(intersection(maskOf(a), maskOf(b)));
}

/**
 * Overlapping slots grouped by day and by identical period set, with the weeks
 * listed, e.g. [{ day: 2, periods: [2, 3], weeks: [1..7, 9..16] }].
 */
export function conflictSummary(a: Timed, b: Timed): ConflictSummaryItem[] {
  return summarizeSlots(conflictSlots(a, b));
}

/** Groups sorted slots: first periods per (week, day), then weeks per (day, period set). */
export function summarizeSlots(sorted: Slot[]): ConflictSummaryItem[] {
  const periodsByWeekDay = new Map<string, { week: number; day: Day; periods: number[] }>();
  for (const { week, day, period } of sorted) {
    const key = `${week}:${day}`;
    const entry = periodsByWeekDay.get(key) ?? { week, day, periods: [] };
    entry.periods.push(period);
    periodsByWeekDay.set(key, entry);
  }

  const items = new Map<string, ConflictSummaryItem>();
  for (const { week, day, periods } of periodsByWeekDay.values()) {
    const key = `${day}:${periods.join(",")}`;
    const item = items.get(key) ?? { day, periods, weeks: [] };
    item.weeks.push(week);
    items.set(key, item);
  }

  return [...items.values()].sort((x, y) => x.day - y.day || comparePeriods(x.periods, y.periods));
}

/** Lexicographic order on period lists. */
function comparePeriods(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

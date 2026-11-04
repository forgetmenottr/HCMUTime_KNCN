import type { Day } from "../parser";
import { DAYS, FIRST_DAY, MASK_WORDS, MAX_WEEK, PERIODS, type TimeMask } from "./constants";

/** A decoded (week, day, period) slot. */
export interface Slot {
  week: number;
  day: Day;
  period: number;
}

/** True if `value` is an integer in [min, max]. */
function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Bit index of a slot, or -1 when any coordinate is out of range. */
export function bitIndex(week: number, day: number, period: number): number {
  const valid =
    inRange(week, 1, MAX_WEEK) && inRange(day, FIRST_DAY, FIRST_DAY + DAYS - 1) && inRange(period, 1, PERIODS);
  return valid ? ((week - 1) * DAYS + (day - FIRST_DAY)) * PERIODS + (period - 1) : -1;
}

/** Inverse of `bitIndex`. */
function decodeBit(bit: number): Slot {
  const dayAndWeek = Math.floor(bit / PERIODS);
  return {
    week: Math.floor(dayAndWeek / DAYS) + 1,
    day: ((dayAndWeek % DAYS) + FIRST_DAY) as Day,
    period: (bit % PERIODS) + 1,
  };
}

/** A mask with no slot set. */
export function emptyMask(): TimeMask {
  return new Uint32Array(MASK_WORDS);
}

/** Sets one slot. Returns false (and changes nothing) when the slot is out of range. */
export function setSlot(mask: TimeMask, week: number, day: number, period: number): boolean {
  const bit = bitIndex(week, day, period);
  if (bit < 0) return false;
  mask[bit >>> 5] |= 1 << (bit & 31);
  return true;
}

/** True if the slot is set; false when it is not set or out of range. */
export function hasSlot(mask: TimeMask, week: number, day: number, period: number): boolean {
  const bit = bitIndex(week, day, period);
  return bit >= 0 && (mask[bit >>> 5] & (1 << (bit & 31))) !== 0;
}

/** target |= source (mutates target). */
export function orInto(target: TimeMask, source: TimeMask): void {
  const words = Math.min(target.length, source.length);
  for (let i = 0; i < words; i++) target[i] |= source[i];
}

/** True if the masks share at least one slot. Stops at the first overlapping word. */
export function intersects(a: TimeMask, b: TimeMask): boolean {
  const words = Math.min(a.length, b.length);
  for (let i = 0; i < words; i++) {
    if ((a[i] & b[i]) !== 0) return true;
  }
  return false;
}

/** A new mask with the slots set in both a and b. */
export function intersection(a: TimeMask, b: TimeMask): TimeMask {
  const result = emptyMask();
  const words = Math.min(a.length, b.length, result.length);
  for (let i = 0; i < words; i++) result[i] = a[i] & b[i];
  return result;
}

/** Number of set bits in a 32-bit word (SWAR). */
function bitCount(word: number): number {
  let x = word - ((word >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Number of set slots. */
export function popcount(mask: TimeMask): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += bitCount(mask[i]);
  return count;
}

/**
 * Decodes every set slot. Bits are laid out week-major, then day, then period,
 * so scanning bits in order yields slots sorted by week, day, period.
 */
export function slots(mask: TimeMask): Slot[] {
  const result: Slot[] = [];
  for (let word = 0; word < mask.length; word++) {
    const bits = mask[word];
    if (bits === 0) continue;
    for (let offset = 0; offset < 32; offset++) {
      if ((bits >>> offset) & 1) result.push(decodeBit(word * 32 + offset));
    }
  }
  return result;
}

/** Highest teaching week a mask can hold (weeks strings are 30 characters long). */
export const MAX_WEEK = 30;
/** Days per week: day 2..8 (Thứ 2..Chủ nhật) → dayIndex 0..6. */
export const DAYS = 7;
/** The day number stored at dayIndex 0 (Thứ 2). */
export const FIRST_DAY = 2;
/** Periods per day: tiết 1..16. */
export const PERIODS = 16;

/** Bit index = ((week - 1) * DAYS + (day - FIRST_DAY)) * PERIODS + (period - 1). */
export const TOTAL_BITS = MAX_WEEK * DAYS * PERIODS; // 3360
/** Number of 32-bit words in a mask. */
export const MASK_WORDS = Math.ceil(TOTAL_BITS / 32); // 105

/** One bit per (week, day, period) slot; see TOTAL_BITS for the layout. */
export type TimeMask = Uint32Array;

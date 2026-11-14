import {
  PREFERRED_ITEMS_WEIGHT,
  clampWeight,
  effectiveMode,
  type ModeControl,
  type PreferencesState,
} from "./preferences";

/**
 * The share percentages of the step-3 screen (docs/ui-change-analysis.md B6).
 *
 * The sliders are RELATIVE weights: the ranking depends only on the ratios
 * between them, so each slider shows its share of the total, live. The total is
 * the same sum the scorer divides by (`softTotal` in score.ts): the time-of-day
 * weight (only when a half-day is chosen), fewerDays, avoidEarly, and the
 * preferred-items weight once for every control in effect as preferred. The
 * hidden weights (compactDays, noCampusSwitch) are 0 and add nothing.
 *
 * Returns numbers only, no text: the screen puts them into `prefs.share.value`
 * and `prefs.share.aria`.
 */

/** The controls of block 2 that can be "preferred", each worth `PREFERRED_ITEMS_WEIGHT`. At most two (B6). */
export const PREFERRED_CONTROLS: readonly ModeControl[] = ["partsOff", "freeSeats"];

/** One slider row. */
export interface SliderShare {
  /** The slider's own 0–10 value, for `aria-valuenow`. Kept even while the row is disabled. */
  value: number;
  /** True for the time-of-day row while the radio says "Không". */
  disabled: boolean;
  /**
   * Whole percent for the number beside the slider and for `aria-valuetext`
   * ("mức {value} trên 10, chiếm {percent}%"), or **null: show "—"** (a disabled
   * row, or nothing set at all). Never 0 for a row that is simply switched off.
   */
  percent: number | null;
}

/** The preferred-items switch's own share. */
export interface PreferredItemsShare {
  /** How many controls are in effect as preferred (0, 1 or 2): `effectiveMode`, not the raw stored mode. */
  count: number;
  /** "chiếm X%" next to the switch, or **null: show nothing** (no control is preferred). */
  percent: number | null;
}

export interface PreferenceShares {
  timeOfDay: SliderShare;
  fewerDays: SliderShare;
  avoidEarly: SliderShare;
  preferredItems: PreferredItemsShare;
  /** The sum the percentages are taken of. */
  total: number;
  /**
   * True when the total is 0: every row shows "—" and the screen shows
   * `prefs.noWishes`. The "Xếp lịch" button stays enabled (B6).
   */
  noWishes: boolean;
}

/**
 * Whole percentages that add up to exactly 100: each weight's share is rounded
 * down, and the points left over go to the largest remainders. A tie goes to the
 * row that comes first in `weights` (the one higher in the B6 table).
 * All zeros when the weights sum to 0.
 *
 * Slider values are whole numbers, so the remainders below are exact integers
 * and a tie is a real tie, not floating-point noise.
 */
export function largestRemainder(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return weights.map(() => 0);
  const floors = weights.map((w) => Math.floor((100 * w) / total));
  // remainder × total, which orders the rows exactly like the remainder itself
  const remainders = weights.map((w, i) => 100 * w - floors[i] * total);
  const leftover = 100 - floors.reduce((sum, f) => sum + f, 0);
  const order = weights.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  const result = [...floors];
  for (const i of order.slice(0, leftover)) result[i] += 1;
  return result;
}

/** What the four rows of the screen show, from the same state `buildPreferences` reads. */
export function computeShares(state: PreferencesState): PreferenceShares {
  const prefer = state.timeOfDay?.prefer;
  const timeActive = prefer === "morning" || prefer === "afternoon";
  const timeWeight = timeActive ? clampWeight(state.timeOfDay.weight) : 0;
  const fewerDays = clampWeight(state.fewerDays);
  const avoidEarly = clampWeight(state.avoidEarly);
  // Reuse effectiveMode, not the raw mode: a control stored as "preferred" while
  // the switch is off, or a time-off grid with nothing ticked, does not count.
  const count = PREFERRED_CONTROLS.filter((control) => effectiveMode(state, control) === "preferred").length;
  const preferredWeight = PREFERRED_ITEMS_WEIGHT * count;

  const total = timeWeight + fewerDays + avoidEarly + preferredWeight;
  const noWishes = total === 0;
  // Table order, which is also the tie-break order (B6).
  const [timePct, fewerPct, earlyPct, preferredPct] = largestRemainder([timeWeight, fewerDays, avoidEarly, preferredWeight]);

  return {
    timeOfDay: { value: clampWeight(state.timeOfDay?.weight), disabled: !timeActive, percent: timeActive && !noWishes ? timePct : null },
    fewerDays: { value: fewerDays, disabled: false, percent: noWishes ? null : fewerPct },
    avoidEarly: { value: avoidEarly, disabled: false, percent: noWishes ? null : earlyPct },
    preferredItems: { count, percent: count > 0 ? preferredPct : null },
    total,
    noWishes,
  };
}

import type { Lang, Section } from "./types";

/** Constraint labels and data values (stage 2), finished in both languages. */
const LABELS_AND_VALUES: readonly Section[] = ["constraint", "dayLong", "dayShort", "partOff", "partStudy", "campus", "kind"];

/** Every section of the dictionary: the shape of a finished language. */
const ALL: readonly Section[] = [...LABELS_AND_VALUES, "name", "ui", "parse", "timing", "solver"];

/**
 * Sections declared finished, per language. The completeness test checks that
 * each one has every code (and nothing else). Both languages are now complete
 * (stage 3 and 4 for Vietnamese, stage 5 for English); a section added to the
 * dictionary later must be added to `ALL` in the same change.
 */
export const COMPLETE: Readonly<Record<Lang, readonly Section[]>> = {
  vi: ALL,
  en: ALL,
};

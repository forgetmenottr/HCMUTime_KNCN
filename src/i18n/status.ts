import type { Lang, Section } from "./types";

/** Constraint labels and data values (stage 2), finished in both languages. */
const LABELS_AND_VALUES: readonly Section[] = ["constraint", "dayLong", "dayShort", "partOff", "partStudy", "campus", "kind"];

/**
 * Sections declared finished, per language. The completeness test checks that
 * each one has every code (and nothing else). Add a section here in the same
 * change that finishes it; at the end every section of both languages is listed.
 */
export const COMPLETE: Readonly<Record<Lang, readonly Section[]>> = {
  // "ui" (stage 3): Vietnamese defines the keys; English follows in stage 5.
  vi: [...LABELS_AND_VALUES, "ui"],
  en: [...LABELS_AND_VALUES],
};

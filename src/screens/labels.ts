import { TABLES, day, getLang, ui } from "../i18n";
import type { Session } from "../lib/parser";

/**
 * Translated labels the screens build from data. They live in the UI layer
 * because they read the i18n tables (`src/model` may not).
 */

/** A value label from a data section of the tables (campus, kind, half-days), falling back to Vietnamese. */
function fromTable<S extends "campus" | "kind" | "partOff" | "partStudy">(section: S, key: string | number): string {
  const own = (TABLES[getLang()][section] as Record<string | number, string | undefined>)[key];
  return own ?? (TABLES.vi[section] as Record<string | number, string | undefined>)[key] ?? String(key);
}

export const campusLabel = (campus: 1 | 2) => fromTable("campus", campus);
export const kindLabel = (kind: "theory" | "lab") => fromTable("kind", kind);
export const partOffLabel = (part: "morning" | "afternoon") => fromTable("partOff", part);
export const partStudyLabel = (part: "morning" | "afternoon") => fromTable("partStudy", part);

/** One segment of a session line. `lab` is set on the periods segment of a lab session: the marker to print after it. */
export interface SessionPart {
  text: string;
  lab?: string;
}

/**
 * A session as SEGMENTS, never as one string (docs/data-contract.md §5, Screen 2):
 * day · periods (+ lab marker) · room · campus · weeks. The screen renders each
 * segment in its own no-wrap span, so the line can only break between
 * segments, never inside "Tuần 4, 6, 10, 12". The values come from the tables
 * with the real arrays, so English picks "Period" or "Periods" itself.
 */
export function sessionParts(session: Session): SessionPart[] {
  const parts: SessionPart[] = [
    { text: day(session.day, "short") },
    { text: ui("courses.periods", { periods: session.periods }), lab: session.kind === "lab" ? `(${kindLabel("lab")})` : undefined },
    { text: session.room },
  ];
  if (session.campus === 1 || session.campus === 2) parts.push({ text: campusLabel(session.campus) });
  parts.push({ text: ui("courses.weeks", { weeks: session.weeks }) });
  return parts;
}

import type { Fmt } from "./types";

/**
 * Small pieces the language tables share. They hold no wording, only the
 * handling of raw values, so both languages treat a param the same way.
 */

/** Shortens raw text from the input or from a JavaScript error before it goes into a sentence. */
export function clip(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** True when a param is missing or blank, so a sentence can say "missing" instead of quoting "". */
export function blank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** "CO2007:A01_A01" → "A01_A01 (CO2007)": the group id first, as screen 2 shows it. */
export function groupKey(key: unknown, f: Fmt): string {
  if (typeof key !== "string" || !key.includes(":")) return f.str(key);
  const at = key.indexOf(":");
  return `${f.str(key.slice(at + 1))} (${f.str(key.slice(0, at))})`;
}

/** The group id alone from a "COURSE:GROUP" key. */
export function groupId(key: unknown, f: Fmt): string {
  return typeof key === "string" && key.includes(":") ? f.str(key.slice(key.indexOf(":") + 1)) : f.str(key);
}

/**
 * The required constraints the student set themselves. `programs` is always
 * required and has no mode control, so advice to "switch it to Preferred" can
 * only name the others.
 */
export function ownRequired(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((name) => name !== "programs") : [];
}

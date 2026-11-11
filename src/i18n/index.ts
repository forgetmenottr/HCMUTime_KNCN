import { fill, list, MISSING, num, plural, runs, str } from "./format";
import { en } from "./en";
import { DEFAULT_LANG, isLang, type CodeSection, type Coded, type Dictionary, type Fmt, type Lang, type Message, type Params } from "./types";
import { vi } from "./vi";

export * from "./types";
export { MISSING } from "./format";

export const TABLES: Readonly<Record<Lang, Dictionary>> = { vi, en };

// ---------------------------------------------------------------------------
// Last resort: built in, so it can never be missing itself.
// ---------------------------------------------------------------------------

const UNKNOWN_ISSUE: Record<Lang, (code: string) => string> = {
  vi: (code) => `Có vấn đề chưa xác định (mã ${code || MISSING})`,
  en: (code) => `Unknown issue (code ${code || MISSING})`,
};

// ---------------------------------------------------------------------------
// Missing-translation reporting. Silent by default; the app turns it on in
// development (e.g. `if (import.meta.env.DEV) setMissingHandler(...)`).
// ---------------------------------------------------------------------------

/**
 * Why a key was reported:
 * - "missing": no translation in the chosen language, so a fallback was used;
 * - "unexpected": a constraint name that the settings the UI sends can never
 *   produce (its mode is always "off"), so seeing it means the object sent to
 *   `solve` is wrong. It still gets a readable label.
 */
export type ReportReason = "missing" | "unexpected";
export type MissingHandler = (info: { lang: Lang; section: string; key: string; reason: ReportReason }) => void;
let onMissing: MissingHandler = () => {};
const reported = new Set<string>();

/** Sets the handler called once per (language, section, key, reason). */
export function setMissingHandler(handler: MissingHandler): void {
  onMissing = handler;
  reported.clear();
}

function reportMissing(lang: Lang, section: string, key: string, reason: ReportReason = "missing"): void {
  const id = `${lang}:${section}:${key}:${reason}`;
  if (reported.has(id)) return;
  reported.add(id);
  try {
    onMissing({ lang, section, key, reason });
  } catch {
    // A broken handler must never break rendering.
  }
}

/**
 * Constraints the step-3 screen always sends with mode "off" (docs/ui-change-analysis.md B4),
 * so they can never appear in `relaxed[]`, `violations[]` or `params.constraints`.
 */
export const UNEXPECTED_CONSTRAINTS: readonly string[] = ["campuses", "language", "avoidLecturers", "daysOff"];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** One section of a table, read by a string key (codes arrive from `lib` typed as plain strings). */
function entry<S extends keyof Dictionary>(lang: Lang, section: S, key: string | number): Dictionary[S][keyof Dictionary[S]] | undefined {
  return (TABLES[lang][section] as Record<string | number, Dictionary[S][keyof Dictionary[S]]>)[key];
}

function lookup<S extends keyof Dictionary>(lang: Lang, section: S, key: string | number) {
  return entry(lang, section, key) ?? (lang === DEFAULT_LANG ? undefined : entry(DEFAULT_LANG, section, key));
}

/** The helpers message functions receive, bound to one language. */
export function formatter(lang: Lang): Fmt {
  const fmt: Fmt = {
    lang,
    str,
    num: (value) => num(lang, value),
    list: (value, map) => list(lang, value, map),
    runs,
    plural: (count, forms) => plural(lang, count, forms),
    day: (value, form = "long") => {
      if (typeof value !== "number" || !Number.isFinite(value)) return MISSING;
      return lookup(lang, form === "long" ? "dayLong" : "dayShort", value) ?? String(value);
    },
    constraint: (value) => label(value, lang),
  };
  return fmt;
}

/** Renders one message; null when it is absent, throws, or comes out blank. */
function render(message: Message | undefined, params: Params, lang: Lang): string | null {
  if (message === undefined) return null;
  try {
    const fmt = formatter(lang);
    const text = typeof message === "string" ? fill(message, params, fmt) : message(params, fmt);
    return typeof text === "string" && text.trim() !== "" ? text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public lookups
// ---------------------------------------------------------------------------

/**
 * `{ code, params }` in, text out. Never "undefined", never blank. Tries, in order:
 * 1. the chosen language's table;
 * 2. in English mode, the English `message` that `lib` already provides;
 * 3. the Vietnamese table (primary language);
 * 4. "unknown issue (code X)" in the chosen language.
 */
export function translate(section: CodeSection, item: Coded, lang: Lang = getLang()): string {
  const ownParams: Params = item.params && typeof item.params === "object" ? item.params : {};
  // Context fields first, so a param of the same name (none today) would win.
  const params: Params = { line: item.line, text: item.text, courseCode: item.courseCode, groupId: item.groupId, ...ownParams };
  const code = typeof item.code === "string" ? item.code : "";
  const own = render(entry(lang, section, code), params, lang);
  if (own !== null) return own;

  reportMissing(lang, section, code);
  if (lang === "en" && typeof item.message === "string" && item.message.trim() !== "") return item.message;
  if (lang !== DEFAULT_LANG) {
    const primary = render(entry(DEFAULT_LANG, section, code), params, DEFAULT_LANG);
    if (primary !== null) return primary;
  }
  return UNKNOWN_ISSUE[lang](code);
}

/** Label of a constraint name; an unknown name comes back as itself, so it is visible and recognisably a bug. */
export function label(constraint: unknown, lang: Lang = getLang()): string {
  if (typeof constraint !== "string" || constraint === "") return MISSING;
  if (UNEXPECTED_CONSTRAINTS.includes(constraint)) reportMissing(lang, "constraint", constraint, "unexpected");
  const own = entry(lang, "constraint", constraint);
  if (own) return own;
  reportMissing(lang, "constraint", constraint);
  return entry(DEFAULT_LANG, "constraint", constraint) || constraint;
}

/** A static UI string; falls back to Vietnamese, then to the key itself. */
export function ui(key: string, params: Params = {}, lang: Lang = getLang()): string {
  const own = render(entry(lang, "ui", key), params, lang);
  if (own !== null) return own;
  reportMissing(lang, "ui", key);
  if (lang !== DEFAULT_LANG) {
    const primary = render(entry(DEFAULT_LANG, "ui", key), params, DEFAULT_LANG);
    if (primary !== null) return primary;
  }
  return key;
}

/** Day name for a day number 2..8. */
export function day(value: number, form: "long" | "short" = "long", lang: Lang = getLang()): string {
  return formatter(lang).day(value, form);
}

// ---------------------------------------------------------------------------
// Language choice: localStorage key "hcmutime.lang", default "vi".
// ---------------------------------------------------------------------------

export const LANG_STORAGE_KEY = "hcmutime.lang";

/** The part of Web Storage this module uses; injectable for tests. */
export interface LangStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage when it exists and can be reached, else null (blocked storage throws on access). */
function browserStore(): LangStore | null {
  try {
    return (globalThis as { localStorage?: LangStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored language, or "vi" when nothing valid is stored or storage is unavailable. */
export function readLang(store: LangStore | null = browserStore()): Lang {
  try {
    const value = store?.getItem(LANG_STORAGE_KEY);
    return isLang(value) ? value : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/** Stores the language; failures (blocked or full storage) are ignored. */
export function writeLang(lang: Lang, store: LangStore | null = browserStore()): void {
  try {
    store?.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // The choice then lasts for this page only.
  }
}

let current: Lang | null = null;
const listeners = new Set<(lang: Lang) => void>();

/** The current language, read from storage on first use. */
export function getLang(): Lang {
  if (current === null) current = readLang();
  return current;
}

/** Changes the language: remembers it, updates <html lang>, and notifies subscribers. */
export function setLang(lang: Lang): void {
  if (!isLang(lang)) return;
  current = lang;
  writeLang(lang);
  try {
    const root = (globalThis as { document?: { documentElement?: { lang: string } } }).document?.documentElement;
    if (root) root.lang = lang;
  } catch {
    // No document (tests, worker): nothing to update.
  }
  for (const listener of listeners) listener(lang);
}

/** Calls `listener` on every language change; returns the unsubscribe function. */
export function subscribeLang(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

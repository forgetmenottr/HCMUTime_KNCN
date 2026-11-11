import type { Fmt, Lang, Params, PluralForms } from "./types";

/** What a template shows for a missing or unusable value. */
export const MISSING = "?";

const numberFormats = new Map<Lang, Intl.NumberFormat>();
const listFormats = new Map<Lang, Intl.ListFormat>();
const pluralRules = new Map<Lang, Intl.PluralRules>();

function cached<T>(cache: Map<Lang, T>, lang: Lang, make: () => T): T {
  let value = cache.get(lang);
  if (value === undefined) {
    value = make();
    cache.set(lang, value);
  }
  return value;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function str(value: unknown): string {
  if (typeof value === "string") return value.trim() === "" ? MISSING : value;
  const n = finite(value);
  return n === null ? MISSING : String(n);
}

export function num(lang: Lang, value: unknown): string {
  const n = finite(value);
  return n === null ? MISSING : cached(numberFormats, lang, () => new Intl.NumberFormat(lang)).format(n);
}

export function list(lang: Lang, value: unknown, map: (item: unknown) => string = str): string {
  if (!Array.isArray(value) || value.length === 0) return MISSING;
  const items = value.map((item) => map(item));
  return cached(listFormats, lang, () => new Intl.ListFormat(lang, { type: "conjunction" })).format(items);
}

export function runs(value: unknown): string {
  if (!Array.isArray(value)) return MISSING;
  const numbers = [...new Set(value.filter((n): n is number => Number.isInteger(n)))].sort((a, b) => a - b);
  if (numbers.length === 0) return MISSING;
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= numbers.length; i++) {
    if (i < numbers.length && numbers[i] === numbers[i - 1] + 1) continue;
    parts.push(i - 1 === start ? `${numbers[start]}` : `${numbers[start]}–${numbers[i - 1]}`);
    start = i;
  }
  return parts.join(", ");
}

export function plural(lang: Lang, count: unknown, forms: PluralForms): string {
  const n = finite(count);
  const rule = n === null ? "other" : cached(pluralRules, lang, () => new Intl.PluralRules(lang)).select(n);
  const form = rule === "one" && forms.one !== undefined ? forms.one : forms.other;
  return form.replaceAll("#", num(lang, count));
}

/** Fills "{name}" slots: arrays become a list, everything else goes through `str`. */
export function fill(template: string, params: Params, fmt: Fmt): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return Array.isArray(value) ? fmt.list(value) : fmt.str(value);
  });
}

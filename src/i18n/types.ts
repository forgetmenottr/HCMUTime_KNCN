import type { Day, ParseWarningCode } from "../lib/parser";
import type { ConstraintName, SolverDiagnosticCode } from "../lib/solver";
import type { TimeWarningCode } from "../lib/timing";

/** Supported languages; Vietnamese is the primary one. */
export const LANGS = ["vi", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "vi";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** `params` as `lib` emits them: untyped, so every template must read them defensively. */
export type Params = Readonly<Record<string, unknown>>;

/** Plural forms for `Fmt.plural`; `#` stands for the formatted number. */
export interface PluralForms {
  one?: string;
  other: string;
}

/** Formatting helpers handed to message functions. Every helper returns "?" for a missing value, never "undefined". */
export interface Fmt {
  readonly lang: Lang;
  /** A scalar param as text. */
  str(value: unknown): string;
  /** A number with the language's digit grouping. */
  num(value: unknown): string;
  /** A list joined with the language's "and" (Intl.ListFormat); `map` turns each item into text first. */
  list(value: unknown, map?: (item: unknown) => string): string;
  /** Sorted runs of integers: [1, 2, 3, 5] → "1–3, 5". */
  runs(value: unknown): string;
  /** Picks a plural form with Intl.PluralRules and puts the number in place of `#`. */
  plural(count: unknown, forms: PluralForms): string;
  /** Day name for a day number 2..8. */
  day(value: unknown, form?: "long" | "short"): string;
  /** Label of a constraint name (the name of the control the user sees). */
  constraint(value: unknown): string;
}

/**
 * One translation. A plain string is a whole-sentence template with named
 * slots ("Dòng {line}"); a function is used when the sentence needs plurals,
 * lists or a condition. Never assemble a sentence from fragments.
 */
export type Message = string | ((params: Params, fmt: Fmt) => string);

/** Half-day keys as the grid and the time-of-day control use them. */
export type HalfDay = "morning" | "afternoon";

/**
 * A language table. Every section is partial while the tables are being
 * written; a section that is finished is declared with `satisfies Record<…>`
 * in its file (so tsc rejects a missing or unknown key), and is listed in
 * `COMPLETE` (status.ts), which the completeness test checks.
 */
export interface Dictionary {
  parse: Partial<Record<ParseWarningCode, Message>>;
  timing: Partial<Record<TimeWarningCode, Message>>;
  solver: Partial<Record<SolverDiagnosticCode, Message>>;
  /** Labels for `violations[].item`, `relaxed[]` and `params.constraints`. */
  constraint: Partial<Record<ConstraintName, string>>;
  dayLong: Partial<Record<Day, string>>;
  dayShort: Partial<Record<Day, string>>;
  /** A half-day the student wants **off** (Ngày/buổi nghỉ grid). */
  partOff: Partial<Record<HalfDay, string>>;
  /** A half-day the student wants to **study** in (Bạn thích học buổi nào?). */
  partStudy: Partial<Record<HalfDay, string>>;
  campus: Partial<Record<1 | 2, string>>;
  kind: Partial<Record<"theory" | "lab", string>>;
  /** Static UI strings, keyed by screen ("paste.parseButton"). */
  ui: Partial<Record<string, Message>>;
}

/** Sections that hold `{ code, params }` messages from `lib`. */
export type CodeSection = "parse" | "timing" | "solver";
export type Section = keyof Dictionary;

/** Anything from `lib` that carries a code: ParseWarning, TimeWarning, SolverDiagnostic. */
export interface Coded {
  code: string;
  params?: Params;
  /** The English text `lib` already provides; used as a fallback in English mode only. */
  message?: string;
  /**
   * Context that `lib` keeps outside `params`: ParseWarning's `line`/`text`,
   * TimeWarning's `courseCode`/`groupId`. `translate` passes them to the
   * template under the same names, so it can say "{courseCode}" directly.
   */
  line?: number;
  text?: string;
  courseCode?: string;
  groupId?: string;
}

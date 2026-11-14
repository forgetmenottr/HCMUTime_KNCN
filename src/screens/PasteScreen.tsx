import { useRef, useState } from "react";
import { ActionBar, Button, Glyph } from "../components/ui";
import { translate, ui } from "../i18n";
import type { ParseResult } from "../lib/parser";
import type { IndexedCourse } from "../lib/timing";

/**
 * Step 1 — "Dán dữ liệu" (docs/ui-visual-spec.md §1, docs/data-contract.md §5 Screen 1).
 *
 * Decided here, where the drawing is silent:
 * - the text is parsed as it changes (there is no "Parse" button);
 * - "Tiếp tục" is disabled until at least one course was read;
 * - an empty box shows the placeholder and no status;
 * - on success the courses that were read are listed, so the student can see at
 *   a glance that the right thing was understood;
 * - the warning box starts open and its list scrolls when it is long.
 */

/** Height of one line of the paste box; "Dòng N" scrolls by it. */
const LINE_HEIGHT = 18;

export function PasteScreen({
  text,
  onText,
  parsed,
  courses,
  onNext,
}: {
  text: string;
  onText: (text: string) => void;
  parsed: ParseResult;
  /** After buildMasks: duplicates are already merged, so the count matches step 2. */
  courses: readonly IndexedCourse[];
  onNext: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [warningsOpen, setWarningsOpen] = useState(true);

  const isBlank = text.trim() === "";
  const found = courses.length > 0;
  // The whole-input warning (line 0) is shown as the status line, not as a row.
  const nothingFound = parsed.warnings.find((w) => w.code === "no-courses-found");
  const lineWarnings = parsed.warnings.filter((w) => w.line > 0);

  /** Selects line `line` (1-based) in the box and scrolls it into view. */
  const jumpTo = (line: number) => {
    const el = box.current;
    if (!el) return;
    const lines = el.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    const end = start + (lines[line - 1]?.length ?? 0);
    el.focus();
    el.setSelectionRange(start, end);
    el.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - el.clientHeight / 2);
    el.scrollLeft = 0;
  };

  /**
   * First run: someone with nothing to paste can still see the whole app work.
   * Three real courses (the repo's fixtures, which have groups in all four
   * programs), loaded only when asked for, so they are not in the main bundle.
   */
  const loadSample = async () => {
    const parts = await Promise.all([
      import("../../tests/fixtures/CO2003.txt?raw"),
      import("../../tests/fixtures/CO2007.txt?raw"),
      import("../../tests/fixtures/CO2011.txt?raw"),
    ]);
    onText(parts.map((m) => m.default.trim()).join("\n"));
  };

  const clear = () => {
    onText("");
    box.current?.focus();
  };

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h1 className="text-[16px] font-semibold">{ui("paste.title")}</h1>
        <button type="button" onClick={loadSample} className="text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
          {ui("paste.sample")}
        </button>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{ui("paste.howTo")}</p>

      <textarea
        ref={box}
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={ui("paste.placeholder")}
        aria-label={ui("paste.title")}
        spellCheck={false}
        wrap="off"
        style={{ lineHeight: `${LINE_HEIGHT}px` }}
        className="mt-3 block h-[300px] w-full resize-y rounded-lg border border-line p-4 font-mono text-[12px] whitespace-pre text-ink-2 placeholder:font-sans placeholder:text-[14px] placeholder:text-ink-3 focus:border-brand"
      />

      {/* One live region, so the outcome of a paste is announced as well as shown. */}
      <div aria-live="polite" className="mt-4 space-y-3">
        {found && (
          <div data-testid="paste-ok">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <Glyph kind="ok" />
              {ui("paste.statusOk", { n: courses.length })}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 pl-6 text-[13px] text-ink-2">
              {courses.map((course) => (
                <li key={course.code} className="whitespace-nowrap">
                  <span className="font-mono font-bold text-ink">{course.code}</span> {course.name}
                  <span className="text-ink-3"> · {ui("courses.groupCount", { n: course.groups.length })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!found && !isBlank && nothingFound && (
          <div data-testid="paste-none">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <Glyph kind="warn" />
              {translate("parse", nothingFound)}
            </div>
            <p className="mt-2 rounded-lg border border-card bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink-2">{ui("paste.hint")}</p>
          </div>
        )}

        {!isBlank && lineWarnings.length > 0 && (
          <div className="rounded-lg border border-card bg-surface" data-testid="paste-warnings">
            <button
              type="button"
              aria-expanded={warningsOpen}
              onClick={() => setWarningsOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-[13px] font-semibold hover:bg-rule"
            >
              <span>{ui("paste.warningsTitle")}</span>
              <span aria-hidden className="text-ink-3">{warningsOpen ? "⌃" : "⌄"}</span>
            </button>
            {warningsOpen && (
              <ul className="max-h-[220px] space-y-1.5 overflow-y-auto px-4 pb-3 text-[13px] leading-snug text-ink-2">
                {lineWarnings.map((w, i) => (
                  <li key={`${w.line}-${w.code}-${i}`} className="flex items-baseline gap-2">
                    <button type="button" onClick={() => jumpTo(w.line)} className="shrink-0 font-medium whitespace-nowrap text-ink underline underline-offset-2 hover:text-ink-3">
                      {ui("paste.line", { line: w.line })}
                    </button>
                    <span>{translate("parse", w)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <ActionBar
        left={
          <Button onClick={clear} disabled={text === ""}>
            {ui("paste.clear")}
          </Button>
        }
        right={
          <Button variant="primary" onClick={onNext} disabled={!found}>
            {ui("nav.next")} <span aria-hidden>›</span>
          </Button>
        }
      />
    </section>
  );
}

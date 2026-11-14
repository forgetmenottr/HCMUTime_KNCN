import { useMemo, useState, type ReactNode } from "react";
import type { SolveState } from "../App";
import { ActionBar, Badge, Button, Glyph, Segmented, cx } from "../components/ui";
import { day, translate, ui } from "../i18n";
import type { SolverDiagnostic } from "../lib/solver";
import {
  GRID_DAYS,
  LAST_DAY_ROW,
  buildResultsView,
  clampWeek,
  firstWeek,
  gridFor,
  neighbourWeek,
  type GridBlock,
  type NoProgramCourse,
  type OptionView,
  type ResultsView,
} from "../model";
import { kindLabel } from "./labels";

/**
 * Step 4 — "Kết quả" (docs/ui-visual-spec.md §4, docs/data-contract.md §5 Screen 4).
 *
 * Everything shown is derived by `buildResultsView` in the model; this file
 * only draws it and translates codes when rendering.
 *
 * Decided here, where the drawing is silent:
 * - while solving: the text `results.solving`, a spinner, and a back button that stops the worker;
 * - the grid opens on "Tất cả" (owner, 2026-11-14); "Theo tuần" starts at the first week that has a session; ‹ › skip empty weeks;
 * - "Xen kẽ tuần" (all-weeks view): ONE dashed block that lists both groups under a small tag;
 * - hovering a block shows its weeks (native tooltip);
 * - "Chi tiết" of the banner opens the diagnostics in place, under the title.
 */

export function ResultsScreen({
  solve,
  onBackToPrefs,
  onBackToCourses,
  onCancel,
  onRetry,
  onDropCourse,
}: {
  solve: SolveState;
  onBackToPrefs: () => void;
  onBackToCourses: () => void;
  /** Stops the running solve (and goes back). */
  onCancel: () => void;
  onRetry: () => void;
  onDropCourse: (courseCode: string) => void;
}) {
  const view = useMemo(() => (solve.phase === "done" ? buildResultsView(solve.result, solve.courses) : null), [solve]);

  if (solve.phase === "solving") {
    return (
      <Centered>
        <div role="status" className="flex items-center gap-3 text-[18px] font-semibold" data-testid="solving">
          <span aria-hidden className="h-5 w-5 rounded-full border-2 border-card border-t-ink" style={{ animation: "spin 0.8s linear infinite" }} />
          {ui("results.solving")}
        </div>
        <Button onClick={onCancel}>
          <span aria-hidden>‹</span> {ui("nav.back")}
        </Button>
      </Centered>
    );
  }

  if (solve.phase === "error") {
    return (
      <Centered>
        <Glyph kind="fail" size={40} />
        <p role="alert" className="text-center text-[18px] font-semibold">{ui("results.workerError")}</p>
        <div className="flex gap-3">
          <Button onClick={onBackToPrefs}>
            <span aria-hidden>‹</span> {ui("nav.back")}
          </Button>
          <Button variant="primary" onClick={onRetry}>
            {ui("results.retry")}
          </Button>
        </div>
      </Centered>
    );
  }

  if (!view) return null;

  if (view.kind === "empty") {
    return (
      <Centered>
        <Glyph kind="warn" size={40} />
        <p className="text-center text-[18px] font-semibold" data-testid="results-empty">{ui("results.empty")}</p>
        <Button variant="primary" onClick={onBackToCourses}>
          <span aria-hidden>‹</span> {ui("step.courses")}
        </Button>
      </Centered>
    );
  }

  if (view.kind === "noProgram") return <NoProgram courses={view.courses} onDropCourse={onDropCourse} onBack={onBackToPrefs} />;

  if (view.kind === "infeasible") {
    return (
      <Centered>
        <Glyph kind="fail" size={40} />
        <h1 className="text-center text-[18px] font-semibold">{ui("results.infeasibleTitle")}</h1>
        <div className="w-full rounded-lg border border-card bg-surface px-4 py-3" data-testid="infeasible-reasons">
          {view.outsideProgram && <p className={cx("text-[13px] leading-relaxed font-medium", view.diagnostics.length > 0 && "mb-1.5")}>{ui("results.outsideProgram")}</p>}
          <DiagnosticList items={view.diagnostics} />
        </div>
        <div className="flex gap-3">
          <Button onClick={onBackToCourses}>
            <span aria-hidden>‹</span> {ui("step.courses")}
          </Button>
          <Button variant="primary" onClick={onBackToPrefs}>
            <span aria-hidden>‹</span> {ui("step.prefs")}
          </Button>
        </div>
      </Centered>
    );
  }

  return <Schedules view={view} onBack={onBackToPrefs} />;
}

// ---------------------------------------------------------------------------
// The full-screen states (§4.8, §4.9): a narrow centred column
// ---------------------------------------------------------------------------

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-[640px] flex-col items-center gap-5 pt-4">{children}</div>;
}

function DiagnosticList({ items }: { items: readonly SolverDiagnostic[] }) {
  return (
    <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
      {items.map((d, i) => (
        <li key={i}>{translate("solver", d)}</li>
      ))}
    </ul>
  );
}

/** A4: these courses have no group in the chosen program. No tabs, no grid: drop a course, or go back. */
function NoProgram({ courses, onDropCourse, onBack }: { courses: readonly NoProgramCourse[]; onDropCourse: (code: string) => void; onBack: () => void }) {
  return (
    <Centered>
      <Glyph kind="warn" size={40} />
      <ul className="w-full rounded-lg border border-card" data-testid="no-program">
        {courses.map((c) => (
          <li key={c.course} className="flex items-center justify-between gap-4 border-b border-rule px-4 py-3.5 last:border-b-0">
            <div>
              {/* One program is passed as a string, several as the array: English agrees "program(s)" with it. */}
              <div className="text-[14px] font-medium">{ui("results.noProgram", { course: c.course, program: c.allowed.length === 1 ? c.allowed[0] : c.allowed })}</div>
              {c.available.length > 0 && <div className="mt-0.5 text-[12px] text-ink-3">{ui("results.noProgramWhy", { available: c.available })}</div>}
            </div>
            <Button onClick={() => onDropCourse(c.course)} className="shrink-0">
              {ui("results.dropCourse")}
            </Button>
          </li>
        ))}
      </ul>
      <Button onClick={onBack}>
        <span aria-hidden>‹</span> {ui("nav.back")}
      </Button>
    </Centered>
  );
}

// ---------------------------------------------------------------------------
// The normal state: banner, tabs, grid, register list
// ---------------------------------------------------------------------------

type SchedulesView = Extract<ResultsView, { kind: "schedules" }>;

function Schedules({ view, onBack }: { view: SchedulesView; onBack: () => void }) {
  const [selected, setSelected] = useState(0);
  // Opens on "Tất cả": the first weeks have no lab sessions yet, so a single week looks like a schedule with pieces missing.
  const [byWeek, setByWeek] = useState(false);
  const [week, setWeek] = useState<number | null>(() => firstWeek(view.options[0]));
  const [detailsOpen, setDetailsOpen] = useState(false);

  const option = view.options[Math.min(selected, view.options.length - 1)];
  const shownWeek = clampWeek(option, week);
  const grid = gridFor(option, byWeek ? shownWeek : null);
  const prev = neighbourWeek(option, shownWeek, -1);
  const next = neighbourWeek(option, shownWeek, 1);

  const select = (index: number) => {
    setSelected(index);
    setWeek(clampWeek(view.options[index], shownWeek)); // keep the week when the new option meets in it
  };

  return (
    <section>
      {view.relaxed ? (
        <div className="mb-5 rounded-lg border border-line bg-surface px-4 py-2.5" data-testid="relaxed-banner">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-ink-3 text-[12px] font-bold text-white">!</span>
            <span className="flex-1 text-[14px] font-medium">{ui("results.relaxedTitle")}</span>
            <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((o) => !o)} className="text-[13px] underline underline-offset-2 hover:text-ink-3">
              {ui("results.relaxedDetails")}
            </button>
          </div>
          {detailsOpen && (
            <div className="mt-2 border-t border-card pt-2 pl-[30px]">
              <DiagnosticList items={view.diagnostics} />
            </div>
          )}
        </div>
      ) : (
        view.diagnostics.length > 0 && (
          <div className="mb-5 rounded-lg border border-card bg-surface px-4 py-2.5">
            <DiagnosticList items={view.diagnostics} />
          </div>
        )
      )}

      <div className="text-[12px] text-ink-3">{ui("results.rankHint")}</div>
      <div role="tablist" className="mt-1 flex items-start border-b border-card">
        {view.options.map((o, i) => (
          <button
            key={o.n}
            type="button"
            role="tab"
            aria-selected={i === selected}
            onClick={() => select(i)}
            className={cx("-mb-px flex flex-col items-start gap-1 self-stretch border-b-2 px-4 pt-2 pb-2.5 text-left", i === selected ? "border-ink" : "border-transparent hover:bg-surface")}
          >
            <span className="flex items-center gap-2">
              <span className={cx("text-[14px] whitespace-nowrap", i === selected ? "font-semibold text-ink" : "text-ink-3")}>{ui("results.option", { n: o.n })}</span>
              {o.best && <Badge tone="solid">{ui("results.bestBadge")}</Badge>}
              {o.tie && <Badge>{ui("results.tie")}</Badge>}
            </span>
            {/* One chip per broken constraint; the chip is one translated string (§4.3). */}
            {o.chips.map((chip) => (
              <span key={chip.item} className={cx(i !== selected && "opacity-80")}>
                <Badge tone="dashed">{ui("results.violation", { item: chip.item, courses: chip.courses })}</Badge>
              </span>
            ))}
          </button>
        ))}
      </div>

      {view.truncated && (
        <p className="mt-3 text-[12px] text-ink-3" data-testid="truncated">
          {ui("results.truncated")}
        </p>
      )}

      <div className="mt-5 flex items-start gap-6">
        <div className="min-w-0 flex-1" role="tabpanel">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Segmented
                label={ui("results.weekByWeek")}
                size="sm"
                cellClassName="px-3 h-8"
                value={byWeek ? "week" : "all"}
                onChange={(v) => setByWeek(v === "week")}
                options={[
                  { value: "all", label: ui("results.weekAll") },
                  { value: "week", label: ui("results.weekByWeek") },
                ]}
              />
              {byWeek && shownWeek !== null && (
                <>
                  <button type="button" aria-label={ui("results.weekPrev")} title={ui("results.weekPrev")} disabled={prev === null} onClick={() => setWeek(prev)} className="ml-2 h-8 w-8 rounded-md border border-line hover:bg-surface disabled:border-card disabled:text-off">
                    ‹
                  </button>
                  <span className="flex h-8 min-w-[76px] items-center justify-center rounded-md border border-line px-3 text-[13px] font-semibold" data-testid="week-label">
                    {ui("courses.weeks", { weeks: [shownWeek] })}
                  </span>
                  <button type="button" aria-label={ui("results.weekNext")} title={ui("results.weekNext")} disabled={next === null} onClick={() => setWeek(next)} className="h-8 w-8 rounded-md border border-line hover:bg-surface disabled:border-card disabled:text-off">
                    ›
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-4 text-[12px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-3.5 w-3.5 rounded-[3px] border border-dashed border-ink-3 bg-white" />
                {kindLabel("lab")}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-3.5 w-3.5 rounded-[3px] border-2 border-ink bg-card" />
                {ui("results.legendViolation")}
              </span>
            </div>
          </div>
          <WeekGrid rows={grid.rows} blocks={grid.blocks} activeDays={grid.activeDays} />
        </div>

        <aside className="w-[300px] shrink-0">
          <h2 className="mb-3 flex h-8 items-center text-[14px] font-semibold">{ui("results.registerList")}</h2>
          <RegisterList option={option} />
          <p className="mt-3 text-[11px] text-ink-3">{ui("results.stats", { ms: view.ms })}</p>
        </aside>
      </div>

      <ActionBar
        left={
          <Button onClick={onBack}>
            <span aria-hidden>‹</span> {ui("nav.back")}
          </Button>
        }
      />
    </section>
  );
}

/** "Các lớp cần đăng ký": the screen's answer, so the group id is the largest text in the column. */
function RegisterList({ option }: { option: OptionView }) {
  return (
    <ul className="rounded-lg border border-card" data-testid="register-list">
      {option.entries.map((entry) => (
        <li key={entry.courseCode} className="border-b border-rule px-4 py-3.5 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[14px] text-ink-2">{entry.courseCode}</span>
              {entry.full && <Badge tone="dashed">{ui("courses.full")}</Badge>}
            </span>
            <span className="font-mono text-[16px] font-bold">{entry.groupId}</span>
          </div>
          {entry.alternatives.length > 0 && (
            <div className="mt-1 text-[12px] leading-snug break-words text-ink-3">{ui("results.alternatives", { list: entry.alternatives })}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The week grid (§4.5): a "Tiết" column and seven days; blocks span their periods
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 32;

function WeekGrid({ rows, blocks, activeDays }: { rows: readonly number[]; blocks: readonly GridBlock[]; activeDays: readonly number[] }) {
  return (
    <div
      className="grid overflow-hidden rounded-lg border border-card"
      style={{ gridTemplateColumns: "48px repeat(7, minmax(0, 1fr))", gridTemplateRows: `${ROW_HEIGHT}px repeat(${rows.length}, ${ROW_HEIGHT}px)` }}
      data-testid="week-grid"
    >
      <div className="flex items-center justify-center border-b border-card bg-surface text-[11px] font-semibold text-ink-3" style={{ gridColumn: 1, gridRow: 1 }}>
        {ui("results.gridPeriod")}
      </div>
      {GRID_DAYS.map((d, i) => (
        <div
          key={d}
          className={cx("flex items-center justify-center border-b border-l border-card bg-surface text-[13px] font-semibold", !activeDays.includes(d) && "text-line")}
          style={{ gridColumn: i + 2, gridRow: 1 }}
        >
          {day(d, "short")}
        </div>
      ))}

      {rows.map((period, r) => {
        // A heavier line after period 6 (morning | afternoon) and after 12 when evening rows exist.
        const heavy = (period === 6 || period === LAST_DAY_ROW) && r < rows.length - 1;
        const line = r === rows.length - 1 ? "" : heavy ? "border-b border-line" : "border-b border-rule";
        return [
          <div key={`p${period}`} aria-label={ui("results.periodRow", { n: period })} className={cx("flex items-center justify-center bg-surface text-[12px] text-ink-3", line)} style={{ gridColumn: 1, gridRow: r + 2 }}>
            {period}
          </div>,
          ...GRID_DAYS.map((d, i) => <div key={`c${period}-${d}`} className={cx("border-l border-rule", line)} style={{ gridColumn: i + 2, gridRow: r + 2 }} />),
        ];
      })}

      {blocks.map((block) => (
        <Block key={`${block.day}-${block.from}`} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: GridBlock }) {
  const violating = block.entries.some((e) => e.violating);
  // Dashed = lab. A shared block is always drawn dashed: alternating weeks is what labs do.
  const dashed = block.alternating || block.entries[0].kind === "lab";
  const place = { gridColumn: GRID_DAYS.indexOf(block.day) + 2, gridRow: `${block.from + 1} / span ${block.to - block.from + 1}` };
  const frame = cx(
    "z-10 m-0.5 overflow-hidden rounded-md px-1.5 py-1 font-mono text-[12px] leading-[15px]",
    dashed ? "border-dashed bg-white" : "bg-card",
    violating ? "border-2 border-ink" : "border border-ink-3",
  );

  if (!block.alternating) {
    const entry = block.entries[0];
    return (
      <div className={frame} style={place} title={ui("courses.weeks", { weeks: entry.weeks })} data-block={`${entry.courseCode}:${entry.groupId}`}>
        <div className="font-bold">{entry.courseCode}</div>
        <div className="text-ink-3">{entry.groupId}</div>
      </div>
    );
  }

  // Two groups in the same periods on different weeks: both are listed, under a tag that says so,
  // so the cell does not read as a clash.
  return (
    <div className={frame} style={place} data-block="alternating">
      <div className="mb-0.5 font-sans text-[10px] leading-[13px] font-semibold tracking-wide text-ink-3 uppercase">{ui("results.alternating")}</div>
      {block.entries.map((entry, i) => (
        <div key={`${entry.courseCode}:${entry.groupId}`} title={ui("courses.weeks", { weeks: entry.weeks })} className={cx("whitespace-nowrap", i > 0 && "mt-0.5 border-t border-dashed border-line pt-0.5")}>
          <span className="font-bold">{entry.courseCode}</span> <span className="text-ink-3">{entry.groupId}</span>
        </div>
      ))}
    </div>
  );
}

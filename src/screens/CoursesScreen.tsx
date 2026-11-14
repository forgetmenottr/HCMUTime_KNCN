import { useState } from "react";
import { ActionBar, Badge, Button, Tooltip, cx } from "../components/ui";
import { translate, ui } from "../i18n";
import { programOf, type Session } from "../lib/parser";
import type { IndexedCourse, IndexedGroup, TimeWarning } from "../lib/timing";
import {
  creditTotals,
  includedCourses,
  isExcluded,
  isIncluded,
  isLocked,
  toggleCourse,
  toggleExclude,
  toggleLock,
  type CourseChoices,
} from "../model";
import { sessionParts } from "./labels";

/**
 * Step 2 — "Môn và lớp" (docs/ui-visual-spec.md §2, docs/data-contract.md §5 Screen 2).
 *
 * Decided here, where the drawing is silent:
 * - several cards can be open at once, and all start closed;
 * - a card shows its first five groups (plus the locked one) until "Xem thêm"; there is no "collapse" link;
 * - time warnings are a "!" mark with a tooltip, on the group row and on the card header;
 * - "Tiếp tục" is disabled only when no course is ticked; everything else is left to the solver's diagnostics.
 */

const FIRST_GROUPS = 5;

/** Column widths measured on the drawing (§2.3): 86 + 54 + 440 + 108 + 64 + 64, 6px apart = 846px. */
const COLUMNS = "grid grid-cols-[86px_54px_440px_108px_64px_64px] gap-x-1.5";

export function CoursesScreen({
  courses,
  warnings,
  choices,
  onChoices,
  onBack,
  onNext,
}: {
  courses: readonly IndexedCourse[];
  warnings: readonly TimeWarning[];
  choices: CourseChoices;
  onChoices: (choices: CourseChoices) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set());
  const flip = (set: ReadonlySet<string>, code: string) => {
    const next = new Set(set);
    if (!next.delete(code)) next.add(code);
    return next;
  };

  const totals = creditTotals(courses, choices);
  const anyIncluded = includedCourses(courses, choices).length > 0;

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h1 className="text-[16px] font-semibold">{ui("step.courses")}</h1>
        <div className="text-[13px] text-ink-3" data-testid="credit-total">
          {totals.unknown > 0
            ? ui("courses.totalCreditsPartial", { n: totals.credits, m: totals.unknown })
            : ui("courses.totalCredits", { n: totals.credits })}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {courses.map((course) => (
          <CourseCard
            key={course.code}
            course={course}
            warnings={warnings.filter((w) => w.courseCode === course.code)}
            choices={choices}
            onChoices={onChoices}
            open={open.has(course.code)}
            onToggleOpen={() => setOpen((s) => flip(s, course.code))}
            showAll={showAll.has(course.code)}
            onShowAll={() => setShowAll((s) => new Set(s).add(course.code))}
          />
        ))}
      </div>

      <ActionBar
        left={
          <Button onClick={onBack}>
            <span aria-hidden>‹</span> {ui("nav.back")}
          </Button>
        }
        right={
          <Button variant="primary" onClick={onNext} disabled={!anyIncluded}>
            {ui("nav.next")} <span aria-hidden>›</span>
          </Button>
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

function WarningMark({ warnings }: { warnings: readonly TimeWarning[] }) {
  if (warnings.length === 0) return null;
  const text = `${ui("courses.warningTitle")}: ${warnings.map((w) => translate("timing", w)).join(" ")}`;
  return (
    <Tooltip text={text} align="start">
      <span tabIndex={0} role="img" aria-label={text} className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-warn text-[11px] font-bold text-white">
        !
      </span>
    </Tooltip>
  );
}

function CourseCard({
  course,
  warnings,
  choices,
  onChoices,
  open,
  onToggleOpen,
  showAll,
  onShowAll,
}: {
  course: IndexedCourse;
  warnings: readonly TimeWarning[];
  choices: CourseChoices;
  onChoices: (choices: CourseChoices) => void;
  open: boolean;
  onToggleOpen: () => void;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const included = isIncluded(choices, course.code);
  const lockedId = choices.locked[course.code];
  const lockedGroup = course.groups.find((g) => g.group.id === lockedId);

  const visible = showAll ? course.groups : course.groups.filter((g, i) => i < FIRST_GROUPS || g.group.id === lockedId);
  const hidden = course.groups.length - visible.length;

  return (
    <div className={cx("rounded-lg border bg-white", open ? "border-brand" : "border-card")} data-course={course.code}>
      <div className={cx("flex items-center gap-3 px-4", open && "border-b border-rule")}>
        <input
          type="checkbox"
          checked={included}
          onChange={() => onChoices(toggleCourse(choices, course.code))}
          aria-label={`${ui("courses.include")}: ${course.code}`}
          title={ui("courses.include")}
          className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
        />
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggleOpen}
          className={cx("flex min-w-0 flex-1 items-center gap-3 rounded py-3.5 text-left hover:text-ink", !included && "opacity-45")}
        >
          <span className="font-mono text-[14px] font-bold">{course.code}</span>
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink-2">{course.name}</span>
          {lockedGroup && included && (
            <span className="rounded-full border border-brand px-2 py-px text-[11px] font-medium whitespace-nowrap">
              {ui("courses.lockedChip", { group: lockedGroup.group.id })}
            </span>
          )}
          <WarningMark warnings={warnings} />
          <span className="text-[13px] whitespace-nowrap text-ink-3">
            {typeof course.credits === "number" ? ui("courses.credits", { n: course.credits }) : ui("courses.creditsUnknown")}
          </span>
          <span className="w-[72px] text-right text-[13px] whitespace-nowrap text-ink-3">{ui("courses.groupCount", { n: course.groups.length })}</span>
          <span aria-hidden className="w-3 text-center text-ink-3">{open ? "⌃" : "⌄"}</span>
        </button>
      </div>

      {open && (
        <div className={cx("px-4 pb-3", !included && "opacity-45")}>
          <div className={cx(COLUMNS, "items-end border-b border-rule py-2 text-[11px] leading-tight font-semibold text-ink-3")}>
            <div>{ui("courses.colGroup")}</div>
            <div>{ui("courses.colProgram")}</div>
            <div>{ui("courses.colSessions")}</div>
            <div>{ui("courses.colSeats")}</div>
            <div className="text-center">{ui("courses.lock")}</div>
            <div className="text-center">{ui("courses.exclude")}</div>
          </div>

          {visible.map((group) => (
            <GroupRow
              key={group.key}
              course={course}
              group={group}
              warnings={warnings.filter((w) => w.groupId === group.group.id)}
              choices={choices}
              onChoices={onChoices}
            />
          ))}

          {hidden > 0 && (
            <button type="button" onClick={onShowAll} className="mt-2.5 text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
              {ui("courses.showMore", { n: hidden })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GroupRow({
  course,
  group,
  warnings,
  choices,
  onChoices,
}: {
  course: IndexedCourse;
  group: IndexedGroup;
  warnings: readonly TimeWarning[];
  choices: CourseChoices;
  onChoices: (choices: CourseChoices) => void;
}) {
  const g = group.group;
  const locked = isLocked(choices, course.code, g.id);
  const excluded = isExcluded(choices, course.code, g.id);
  const full = g.registered >= g.capacity;
  const faded = excluded && "opacity-40";

  return (
    // Cells line up with the first line of the first session, not with the middle of a tall row (§2.4).
    <div className={cx(COLUMNS, "-mx-2 items-start rounded border-b border-rule px-2 py-[9px] last:border-b-0", locked && "bg-surface")} data-group={g.id}>
      <div className={cx("flex items-center gap-1 font-mono text-[13px] leading-[18px]", locked && "font-bold", faded)}>
        {g.id}
        <WarningMark warnings={warnings} />
      </div>
      <div className={cx(faded)}>
        <span className="inline-block rounded border border-card bg-surface px-1.5 font-mono text-[11px] leading-[16px]">{programOf(g)}</span>
      </div>
      <div className={cx("space-y-1.5 pr-2", faded)}>
        {g.sessions.map((session, i) => (
          <SessionLine key={i} session={session} />
        ))}
      </div>
      <div className={cx("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-[18px]", faded)}>
        <span className="tabular-nums">
          {g.registered}/{g.capacity}
        </span>
        {full && <Badge>{ui("courses.full")}</Badge>}
      </div>
      <div className="flex justify-center pt-px">
        {/* Looks like a radio (one per course), but clicking the chosen one clears it, so it is a toggle button. */}
        <button
          type="button"
          aria-pressed={locked}
          aria-label={ui("courses.lock")}
          title={ui("courses.lock")}
          onClick={() => onChoices(toggleLock(choices, course.code, g.id))}
          className={cx("flex h-4 w-4 items-center justify-center rounded-full border bg-white hover:border-brand", locked ? "border-brand" : "border-line")}
        >
          {locked && <span className="h-2 w-2 rounded-full bg-brand" />}
        </button>
      </div>
      <div className="flex justify-center pt-px">
        <input
          type="checkbox"
          checked={excluded}
          onChange={() => onChoices(toggleExclude(choices, course.code, g.id))}
          aria-label={ui("courses.exclude")}
          title={ui("courses.exclude")}
          className="h-4 w-4 cursor-pointer accent-brand"
        />
      </div>
    </div>
  );
}

/**
 * One session: each segment in its own no-wrap span, the " ·" kept with the
 * segment before the break, an ordinary space between segments as the only
 * place the line may wrap, and continuation lines indented 12px (§2.4).
 */
function SessionLine({ session }: { session: Session }) {
  const parts = sessionParts(session);
  return (
    <div className="pl-3 -indent-3 text-[12px] leading-[15px] text-ink-2">
      {parts.map((part, i) => (
        <span key={i}>
          <span className="whitespace-nowrap">
            {part.text}
            {part.lab && (
              <>
                {" "}
                <Tooltip text={ui("courses.labTip")}>
                  <span tabIndex={0} className="cursor-help underline decoration-line decoration-dotted underline-offset-2">
                    {part.lab}
                  </span>
                </Tooltip>
              </>
            )}
            {i < parts.length - 1 && " ·"}
          </span>
          {i < parts.length - 1 && " "}
        </span>
      ))}
    </div>
  );
}

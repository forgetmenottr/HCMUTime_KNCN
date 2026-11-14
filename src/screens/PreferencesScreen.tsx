import type { ReactNode } from "react";
import { ActionBar, Button, Help, Segmented, Tooltip, cx, type SegmentOption } from "../components/ui";
import { day, ui } from "../i18n";
import type { Day } from "../lib/parser";
import { AFTERNOON, MORNING, type Mode } from "../lib/solver";
import {
  GRID_DAYS,
  GRID_PARTS,
  TOP_K_MAX,
  TOP_K_MIN,
  computeShares,
  dayState,
  effectiveMode,
  isPaused,
  setTimeOfDay,
  toggleCell,
  toggleWholeDay,
  validCells,
  type GridPart,
  type ModeControl,
  type PreferencesState,
  type ProgramOption,
  type SliderShare,
} from "../model";
import { partOffLabel, partStudyLabel } from "./labels";

/**
 * Step 3 — "Mong muốn" (docs/ui-visual-spec.md §3, docs/ui-change-analysis.md Part B).
 *
 * This screen only edits `PreferencesState`; what is sent to `solve` is built
 * from it by `buildPreferences` in the model. Every rule that changes the state
 * (first tick, whole-day cell, the slider jumping to 5) is a model function.
 *
 * Tooltips (not drawn, decided here): labels that have an explanation carry a
 * small "?" next to them; choices explain themselves on hover and on focus.
 */

const RANGES: Record<GridPart, { first: number; last: number }> = { morning: MORNING, afternoon: AFTERNOON };
const rangeText = (part: GridPart) => ui("prefs.periodRange", { from: RANGES[part].first, to: RANGES[part].last });

export function PreferencesScreen({
  state,
  onState,
  programs,
  onBack,
  onSolve,
}: {
  state: PreferencesState;
  onState: (state: PreferencesState) => void;
  programs: readonly ProgramOption[];
  onBack: () => void;
  onSolve: () => void;
}) {
  const shares = computeShares(state);
  const hasProgram = typeof state.program === "string" && state.program !== "";

  const programOptions: SegmentOption<string>[] = programs.map((p) => ({
    value: p.code,
    label: p.known ? p.code : ui("prefs.program.other", { prefix: p.code }),
    dim: !p.present,
    tip: !p.present && ui("prefs.program.absentTip"),
  }));

  const setTopK = (n: number) => onState({ ...state, topK: Math.min(TOP_K_MAX, Math.max(TOP_K_MIN, n)) });
  // "Hiển thị {n} phương án" is one sentence with the live number in it: render it with the real
  // number, then put the stepper where that number is (data-contract.md §5, Screen 3).
  const sentence = ui("prefs.topK", { n: state.topK });
  const at = sentence.indexOf(String(state.topK));
  const [before, after] = at < 0 ? [sentence, ""] : [sentence.slice(0, at), sentence.slice(at + String(state.topK).length)];

  return (
    <section className="space-y-7">
      {/* ---- Block 1: program ------------------------------------------------ */}
      <div>
        <h2 className="text-[16px] font-semibold">{ui("prefs.block.program")}</h2>
        <div className="mt-3">
          <Segmented
            label={ui("prefs.block.program")}
            options={programOptions}
            value={state.program}
            onChange={(program) => onState({ ...state, program })}
            cellClassName="min-w-[64px] px-5"
          />
        </div>
      </div>

      {/* ---- Block 2: which groups can be chosen ------------------------------ */}
      <div>
        <h2 className="text-[16px] font-semibold">{ui("prefs.block.groups")}</h2>
        <div className="mt-3 rounded-lg border border-card">
          <div className="flex items-center gap-3 rounded-t-lg border-b border-rule bg-surface px-5 py-3">
            <Tooltip text={ui("prefs.preferredSwitch.hint")} align="start">
              <button
                type="button"
                role="switch"
                aria-checked={state.preferredSwitch}
                aria-label={ui("prefs.preferredSwitch.label")}
                onClick={() => onState({ ...state, preferredSwitch: !state.preferredSwitch })}
                className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", state.preferredSwitch ? "bg-brand" : "bg-line")}
              >
                <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", state.preferredSwitch ? "left-[18px]" : "left-0.5")} />
              </button>
            </Tooltip>
            <span className="flex-1 text-[14px] font-medium">{ui("prefs.preferredSwitch.label")}</span>
            {shares.preferredItems.percent !== null && (
              <span className="text-[13px] font-semibold" data-testid="share-preferred">
                {ui("prefs.share.value", { p: shares.preferredItems.percent })}
              </span>
            )}
          </div>

          {/* Ngày/buổi nghỉ: the label sits ABOVE the grid in both languages (§3.1). */}
          <div className="border-b border-rule px-5 py-4">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              {ui("prefs.partsOff.label")}
              <Help text={ui("prefs.partsOff.tip")} align="start" />
            </div>
            <div className="mt-3 flex items-start justify-between">
              <TimeOffGrid state={state} onState={onState} />
              <ModeSelect state={state} onState={onState} control="partsOff" label={ui("prefs.partsOff.label")} />
            </div>
          </div>

          <div className="flex items-start justify-between px-5 py-4">
            <div className="flex items-center gap-2 pt-1 text-[14px] font-medium">
              {ui("prefs.freeSeats.label")}
              <Help text={ui("prefs.freeSeats.tip")} align="start" />
            </div>
            <ModeSelect state={state} onState={onState} control="freeSeats" label={ui("prefs.freeSeats.label")} />
          </div>
        </div>
      </div>

      {/* ---- Block 3: what the schedule should look like ---------------------- */}
      <div>
        <h2 className="text-[16px] font-semibold">{ui("prefs.block.schedule")}</h2>
        <div className="mt-3 space-y-6 rounded-lg border border-card px-5 py-5">
          <SliderRow
            id="timeOfDay"
            label={ui("prefs.timeOfDay.label")}
            tip={ui("prefs.timeOfDay.tip")}
            low={ui("prefs.timeOfDay.low")}
            high={ui("prefs.timeOfDay.high")}
            share={shares.timeOfDay}
            onValue={(weight) => onState({ ...state, timeOfDay: { ...state.timeOfDay, weight } })}
          >
            <Segmented
              label={ui("prefs.timeOfDay.label")}
              value={state.timeOfDay.prefer}
              onChange={(prefer) => onState(setTimeOfDay(state, prefer))}
              cellClassName="w-[120px]"
              options={[
                { value: "morning", label: partStudyLabel("morning"), tip: `${partStudyLabel("morning")} (${rangeText("morning")})` },
                { value: "afternoon", label: partStudyLabel("afternoon"), tip: `${partStudyLabel("afternoon")} (${rangeText("afternoon")})` },
                { value: "none", label: ui("prefs.timeOfDay.none") },
              ]}
            />
          </SliderRow>
          <SliderRow
            id="fewerDays"
            label={ui("prefs.fewerDays.label")}
            tip={ui("prefs.fewerDays.tip")}
            low={ui("prefs.fewerDays.low")}
            high={ui("prefs.fewerDays.high")}
            share={shares.fewerDays}
            onValue={(fewerDays) => onState({ ...state, fewerDays })}
          />
          <SliderRow
            id="avoidEarly"
            label={ui("prefs.avoidEarly.label")}
            tip={ui("prefs.avoidEarly.tip")}
            low={ui("prefs.avoidEarly.low")}
            high={ui("prefs.avoidEarly.high")}
            share={shares.avoidEarly}
            onValue={(avoidEarly) => onState({ ...state, avoidEarly })}
          />
          {shares.noWishes && (
            <p className="rounded-md bg-surface px-3 py-2 text-[13px] text-ink-2" data-testid="no-wishes">
              {ui("prefs.noWishes")}
            </p>
          )}
        </div>
      </div>

      <ActionBar
        left={
          <Button onClick={onBack}>
            <span aria-hidden>‹</span> {ui("nav.back")}
          </Button>
        }
        right={
          <>
            {!hasProgram && <span className="text-[13px] text-ink-3">{ui("prefs.program.required")}</span>}
            <div className="flex items-center gap-2 text-[14px]" data-testid="top-k">
              <span>{before.trim()}</span>
              <span className="inline-flex h-9 items-center rounded-md border border-line">
                <button type="button" onClick={() => setTopK(state.topK - 1)} disabled={state.topK <= TOP_K_MIN} className="h-full w-8 rounded-l-md text-ink-3 hover:bg-surface disabled:text-off">
                  −
                </button>
                <output className="w-8 text-center font-semibold tabular-nums">{state.topK}</output>
                <button type="button" onClick={() => setTopK(state.topK + 1)} disabled={state.topK >= TOP_K_MAX} className="h-full w-8 rounded-r-md text-ink-3 hover:bg-surface disabled:text-off">
                  +
                </button>
              </span>
              <span>{after.trim()}</span>
            </div>
            <Button variant="primary" onClick={onSolve} disabled={!hasProgram}>
              {ui("prefs.solve")}
            </Button>
          </>
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// The "Ngày/buổi nghỉ" grid (§3.3): 68px labels + 7 × 52px days, 4px apart = 460px
// ---------------------------------------------------------------------------

function TimeOffGrid({ state, onState }: { state: PreferencesState; onState: (s: PreferencesState) => void }) {
  const cells = validCells(state.partsOff.cells);
  const ticked = (d: Day, part: GridPart) => cells.some((c) => c.day === d && c.part === part);
  // While the switch pauses an "Ưu tiên" grid, the ticks stay but are dimmed: kept, not in effect (§3.4).
  const paused = isPaused(state, "partsOff");

  return (
    <div className={cx("grid w-[460px] grid-cols-[68px_repeat(7,52px)] items-center gap-x-1 gap-y-1", paused && "opacity-45")} data-testid="time-off-grid">
      <div />
      {GRID_DAYS.map((d) => (
        <div key={d} className="pb-1 text-center text-[14px] font-semibold">
          {day(d, "short")}
        </div>
      ))}

      <div className="text-[12px] font-semibold">{ui("prefs.partsOff.wholeDay")}</div>
      {GRID_DAYS.map((d) => {
        const s = dayState(cells, d);
        return (
          <button
            key={d}
            type="button"
            role="checkbox"
            aria-checked={s === "all" ? true : s === "partial" ? "mixed" : false}
            aria-label={`${day(d, "long")}, ${ui("prefs.partsOff.wholeDay")}`}
            onClick={() => onState(toggleWholeDay(state, d))}
            className={cx(
              "mb-1 flex h-7 items-center justify-center rounded-md text-[13px] font-bold",
              s === "all" && "bg-brand text-white hover:bg-brand-2",
              s === "partial" && "border-[1.5px] border-brand bg-white hover:bg-surface",
              s === "none" && "border border-line bg-white hover:border-ink-3 hover:bg-surface",
            )}
          >
            {s === "all" && "✓"}
            {s === "partial" && <span className="h-0.5 w-3 bg-brand" />}
          </button>
        );
      })}

      {GRID_PARTS.map((part) => (
        <PartRow key={part} part={part} ticked={(d) => ticked(d, part)} onToggle={(d) => onState(toggleCell(state, { day: d, part }))} />
      ))}
    </div>
  );
}

function PartRow({ part, ticked, onToggle }: { part: GridPart; ticked: (d: Day) => boolean; onToggle: (d: Day) => void }) {
  const label = partOffLabel(part);
  return (
    <>
      <div className="text-[12px] text-ink-3">
        <Tooltip text={`${label} (${rangeText(part)})`} align="start">
          <span tabIndex={0} className="cursor-help">
            {label}
          </span>
        </Tooltip>
      </div>
      {GRID_DAYS.map((d) => (
        <button
          key={d}
          type="button"
          role="checkbox"
          aria-checked={ticked(d)}
          aria-label={`${day(d, "long")}, ${label}`}
          onClick={() => onToggle(d)}
          className={cx("h-[22px] rounded", ticked(d) ? "bg-brand hover:bg-brand-2" : "border border-line bg-white hover:border-ink-3 hover:bg-surface")}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tắt / Ưu tiên / Bắt buộc (§3.4): three cells of 92px, the same width in both languages
// ---------------------------------------------------------------------------

function ModeSelect({
  state,
  onState,
  control,
  label,
}: {
  state: PreferencesState;
  onState: (s: PreferencesState) => void;
  control: ModeControl;
  label: string;
}) {
  const paused = isPaused(state, control);
  // An empty grid cannot have a mode (B8): the selector is switched off and shows what is sent, "Tắt".
  const empty = control === "partsOff" && validCells(state.partsOff.cells).length === 0;
  const options: SegmentOption<Mode>[] = [
    { value: "off", label: ui("prefs.mode.off") },
    {
      value: "preferred",
      label: ui("prefs.mode.preferred"),
      disabled: !state.preferredSwitch,
      tip: state.preferredSwitch ? ui("prefs.mode.preferredTip") : ui("prefs.preferredSwitch.disabledTip"),
    },
    { value: "required", label: ui("prefs.mode.required"), tip: ui("prefs.mode.requiredTip") },
  ];
  return (
    <div className="flex w-[278px] flex-col items-end" data-testid={`mode-${control}`}>
      <Segmented
        label={label}
        size="sm"
        cellClassName="w-[92px]"
        options={options}
        // What is in effect: "Tắt" while paused or while the grid is empty, the stored choice otherwise.
        value={effectiveMode(state, control)}
        disabled={empty}
        onChange={(mode) => onState({ ...state, [control]: { ...state[control], mode } })}
      />
      {paused && !empty && <div className="mt-1 text-[11px] text-ink-3">{ui("prefs.preferredSwitch.paused")}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A slider with its share of the total (§3.6)
// ---------------------------------------------------------------------------

function SliderRow({
  id,
  label,
  tip,
  low,
  high,
  share,
  onValue,
  children,
}: {
  id: string;
  label: string;
  tip: string;
  low: string;
  high: string;
  share: SliderShare;
  onValue: (value: number) => void;
  /** The Sáng / Chiều / Không choice of the time-of-day row. */
  children?: ReactNode;
}) {
  return (
    <div data-testid={`slider-${id}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <label htmlFor={`slider-${id}`}>{label}</label>
          <Help text={tip} align="start" />
        </div>
        {/* The number is the row's share of the total, not the raw 0–10 value (B6). */}
        <Tooltip text={ui("prefs.share.label")} align="end">
          <span tabIndex={0} data-testid={`share-${id}`} className={cx("text-[13px] font-semibold tabular-nums", share.percent === null && "text-line")}>
            {share.percent === null ? "—" : `${share.percent}%`}
          </span>
        </Tooltip>
      </div>
      {children && <div className="mt-3">{children}</div>}
      <div className={cx(share.disabled && "opacity-60")}>
        <input
          id={`slider-${id}`}
          type="range"
          min={0}
          max={10}
          step={1}
          value={share.value}
          disabled={share.disabled}
          aria-valuetext={share.percent === null ? undefined : ui("prefs.share.aria", { v: share.value, p: share.percent })}
          onChange={(e) => onValue(Number(e.target.value))}
          className={cx("mt-3 block h-4 w-full", share.disabled ? "accent-line" : "cursor-pointer accent-brand")}
        />
        <div className="mt-1 flex justify-between text-[11px] text-ink-3">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      </div>
    </div>
  );
}

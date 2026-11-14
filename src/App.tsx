import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ui, type UiKey } from "./i18n";
import { useLang } from "./i18n/useLang";
import { parse } from "./lib/parser";
import type { SolveResult } from "./lib/solver";
import { buildMasks, type IndexedCourse } from "./lib/timing";
import {
  buildSolveInput,
  dropCourse,
  includedCourses,
  initialPreferencesState,
  loadState,
  programOptions,
  saveState,
  type CourseChoices,
  type PreferencesState,
  type StateStore,
} from "./model";
import { CoursesScreen } from "./screens/CoursesScreen";
import { PasteScreen } from "./screens/PasteScreen";
import { PreferencesScreen } from "./screens/PreferencesScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { SolveCancelled, createSolverClient, type SolverClient } from "./solverClient";

/** The four steps, in order; the names are `step.*` in the i18n tables. */
export const STEPS = ["paste", "courses", "prefs", "results"] as const;
export type Step = (typeof STEPS)[number];

/** What step 4 has to show. `courses` are the ones that were sent, so alternatives can be resolved. */
export type SolveState =
  | { phase: "idle" }
  | { phase: "solving" }
  | { phase: "done"; result: SolveResult; courses: IndexedCourse[] }
  | { phase: "error" };

/** localStorage when it exists and can be reached; blocked storage throws on access. */
function browserStorage(): StateStore | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface AppProps {
  /** Injected in tests; the real one talks to the Web Worker. */
  solver?: SolverClient;
  /** Injected in tests; `null` means "no storage". */
  storage?: StateStore | null;
}

export default function App({ solver, storage }: AppProps) {
  const [lang, setLang] = useLang();

  const store = useMemo(() => (storage === undefined ? browserStorage() : storage), [storage]);
  const clientRef = useRef<SolverClient | null>(null);
  const client = useCallback((): SolverClient => (clientRef.current ??= solver ?? createSolverClient()), [solver]);

  // ---- State shared by the four steps -------------------------------------
  const [saved] = useState(() => loadState(store));
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [choices, setChoices] = useState<CourseChoices>(saved.choices);
  const [prefs, setPrefs] = useState<PreferencesState>(() => initialPreferencesState(saved.program));
  const [solveState, setSolveState] = useState<SolveState>({ phase: "idle" });
  const [solveSeq, setSolveSeq] = useState(0);

  // parse and buildMasks are fast and pure: they run as the text changes, nothing is stored.
  const parsed = useMemo(() => parse(text), [text]);
  const built = useMemo(() => buildMasks(parsed.courses), [parsed]);
  const hasCourses = built.courses.length > 0;

  // Remember the program and the step-2 choices (never the whole preference object: see model/persistence.ts).
  useEffect(() => {
    saveState(store, { program: prefs.program, choices });
  }, [store, prefs.program, choices]);

  // A worker left running would keep a CPU core busy after the page is gone.
  useEffect(() => () => clientRef.current?.cancel(), []);

  // ---- Solving -------------------------------------------------------------
  /** Runs the solver with the current state; `withChoices` lets "Bỏ môn này và xếp lại" solve before the state settles. */
  const startSolve = useCallback(
    (withChoices: CourseChoices = choices) => {
      // One model function builds the whole request, including the rule that keeps
      // groups of other programs away from the solver (see model/solveInput.ts).
      const input = buildSolveInput(built.courses, withChoices, prefs);
      if (!input) return; // no program chosen: the button is disabled anyway
      const { courses, prefs: payload } = input;
      setStep("results");
      setSolveState({ phase: "solving" });
      client()
        .solve(courses, payload)
        .then((result) => {
          setSolveSeq((n) => n + 1);
          setSolveState({ phase: "done", result, courses });
        })
        .catch((error: unknown) => {
          if (error instanceof SolveCancelled) return; // stopped on purpose: whoever stopped it set the state
          console.error(error);
          setSolveState({ phase: "error" });
        });
    },
    [built.courses, choices, prefs, client],
  );

  /** Stops a running solve and goes back to the preferences. */
  const cancelSolve = useCallback(() => {
    client().cancel();
    setSolveState({ phase: "idle" });
    setStep("prefs");
  }, [client]);

  // ---- Navigation ----------------------------------------------------------
  /** A step can be opened when what it shows exists: courses for 2 and 3, a solve for 4. */
  const canOpen = (target: Step): boolean =>
    target === "paste" || (target === "results" ? solveState.phase !== "idle" : hasCourses);

  const go = (target: Step) => {
    if (!canOpen(target) || target === step) return;
    // Leaving the results while the solver runs stops it: nobody is waiting for that answer.
    if (step === "results" && solveState.phase === "solving") {
      client().cancel();
      setSolveState({ phase: "idle" });
    }
    setStep(target);
  };

  // Edits to the paste or to step 2 make an old result stale; drop it so step 4 cannot show it.
  const editText = (value: string) => {
    setText(value);
    dropResult();
  };

  const dropResult = () => {
    if (solveState.phase === "idle") return;
    client().cancel();
    setSolveState({ phase: "idle" });
  };
  const editPrefs = (next: PreferencesState) => {
    setPrefs(next);
    dropResult();
  };
  const editChoices = (next: CourseChoices) => {
    setChoices(next);
    dropResult();
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between bg-brand px-10 text-white">
        <div className="flex items-center gap-2.5 text-[20px] font-bold tracking-tight">
          <Mark />
          HCMUTIME
        </div>
        <div className="flex items-center gap-4">
          <Stepper current={step} canOpen={canOpen} onOpen={go} />
          <span aria-hidden className="h-5 w-px bg-white/25" />
          <LangSwitch lang={lang} onChange={setLang} />
        </div>
      </header>

      <main className={(step === "results" ? "px-10 py-8" : "mx-auto w-[880px] py-8") + " flex-1"} data-step={step}>
        {step === "paste" && (
          <PasteScreen text={text} onText={editText} parsed={parsed} courses={built.courses} onNext={() => go("courses")} />
        )}
        {step === "courses" && (
          <CoursesScreen
            courses={built.courses}
            warnings={built.warnings}
            choices={choices}
            onChoices={editChoices}
            onBack={() => go("paste")}
            onNext={() => go("prefs")}
          />
        )}
        {step === "prefs" && (
          <PreferencesScreen
            state={prefs}
            onState={editPrefs}
            programs={programOptions(includedCourses(built.courses, choices))}
            onBack={() => go("courses")}
            onSolve={() => startSolve()}
          />
        )}
        {step === "results" && (
          <ResultsScreen
            // A new result starts on its first tab and first week.
            key={solveState.phase === "done" ? `done-${solveSeq}` : solveState.phase}
            solve={solveState}
            onBackToPrefs={() => go("prefs")}
            onBackToCourses={() => go("courses")}
            onCancel={cancelSolve}
            onRetry={() => startSolve()}
            onDropCourse={(code) => {
              // "Bỏ môn này và xếp lại": untick the course, then solve again without it (A4).
              const next = dropCourse(choices, code);
              setChoices(next);
              startSolve(next);
            }}
          />
        )}
      </main>

      {/*
        Do not remove. The app wears the university's colours and reads its registration
        data; without this line a student could take it for an official tool and blame the
        university when a timetable is wrong.
      */}
      <footer className="shrink-0 border-t border-rule px-10 py-4 text-center text-[12px] text-ink-3">{ui("footer.disclaimer")}</footer>
    </div>
  );
}

/**
 * The app's own mark (not the university's logo): three class blocks on a
 * timetable tile. public/favicon.svg is the same drawing, navy tile and white blocks.
 */
function Mark() {
  return (
    <svg aria-hidden width="26" height="26" viewBox="0 0 32 32" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="#ffffff" />
      <g className="fill-brand">
        <rect x="6" y="7" width="5" height="11" rx="1.5" />
        <rect x="13.5" y="12" width="5" height="13" rx="1.5" />
        <rect x="21" y="7" width="5" height="7" rx="1.5" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Top bar pieces (docs/ui-visual-spec.md §0.2, §0.6)
// ---------------------------------------------------------------------------

function Stepper({ current, canOpen, onOpen }: { current: Step; canOpen: (s: Step) => boolean; onOpen: (s: Step) => void }) {
  return (
    <nav>
      <ol className="flex items-center">
        {STEPS.map((s, i) => {
          const active = s === current;
          const enabled = canOpen(s);
          return (
            <li key={s} className="flex items-center">
              {i > 0 && <span aria-hidden className="h-px w-4 bg-white/25" />}
              <button
                type="button"
                disabled={!enabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onOpen(s)}
                className={
                  "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] whitespace-nowrap " +
                  // The header is navy, so the active step is the inverse: a white pill with navy text.
                  (active
                    ? "bg-white font-semibold text-brand"
                    : enabled
                      ? "bg-white/10 text-white/85 hover:bg-white/20 hover:text-white"
                      : "text-white/45")
                }
              >
                <span
                  className={
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold " +
                    (active ? "bg-brand text-white" : enabled ? "bg-white/25 text-white" : "border border-white/45 text-white/45")
                  }
                >
                  {i + 1}
                </span>
                {ui(`step.${s}` as UiKey)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The two language names are never translated (see vi.ts). */
const LANG_CHOICES = [
  { code: "vi", short: "VI", name: "Tiếng Việt" },
  { code: "en", short: "EN", name: "English" },
] as const;

function LangSwitch({ lang, onChange }: { lang: string; onChange: (lang: "vi" | "en") => void }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={ui("lang.switch")}>
      <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-white/85">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M1.5 8h13M8 1.5c2 2 2.8 4.2 2.8 6.5S10 12.5 8 14.5C6 12.5 5.2 10.3 5.2 8S6 3.500 8 1.5z" />
      </svg>
      <div className="flex overflow-hidden rounded border border-white/45 text-[11px]">
        {LANG_CHOICES.map((choice) => (
          <button
            key={choice.code}
            type="button"
            lang={choice.code}
            title={choice.name}
            aria-label={choice.name}
            aria-pressed={lang === choice.code}
            onClick={() => onChange(choice.code)}
            className={"px-2 py-1 font-semibold " + (lang === choice.code ? "bg-white text-brand" : "text-white/85 hover:bg-white/15")}
          >
            {choice.short}
          </button>
        ))}
      </div>
    </div>
  );
}

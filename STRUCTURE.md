# Project Structure — HCMUT Timetable Scheduling Application (Rebuilt, Simplified)

## What the Application Does

Students paste course blocks copied from the **Course Registration** page and receive the five best non-overlapping timetables. The application runs entirely in the browser: no backend and no user accounts.

## Data Flow

```
pasted text ─ parse() ─► Course[] + warnings              src/lib/parser/
            ─ buildMasks() ─► groups with 3360-bit masks  src/lib/timing/
            ─ solve(courses, prefs) ─► top-5 schedules    src/lib/solver/ (runs in a Web Worker)
            ─ App.tsx ─► results table                    src/
```

## Layering Rules

`src/lib/**` contains pure code: it does not import React or use `window`, `document`, or `localStorage`. Therefore, all critical components can be tested in Node. Dependencies flow downward through the layers only:

```
parser  ←  timing  ←  solver  ←  src/App.tsx  ←  src/main.tsx
```

## Directory Structure

```
HCMUTime_KNCN/
├── package.json                [B1]  dev / build / test commands; only react and react-dom are needed at runtime
├── package-lock.json           [B1]  exact versions of all packages
├── .gitignore                  [B1]  excludes node_modules, dist, etc.
├── tsconfig.json               [B1]  combines the two configurations below
├── tsconfig.app.json           [B1]  src/ — runs in the browser with DOM support
├── tsconfig.node.json          [B1]  vite.config.ts + tests/ — runs in Node
├── vite.config.ts              [B1]  React plugin, ES module Worker, Vitest configuration
├── index.html                  [B6]  root page; loads src/main.tsx
├── .github/workflows/ci.yml    [B6]  CI: runs test + tsc on every push
│
├── src/
│   ├── main.tsx                [B6]  mounts <App /> into the page
│   ├── App.tsx                 [B6]  minimal UI: paste box, "Generate Schedule" button, results table
│   └── lib/                          pure library (preserved as-is from the original version)
│       ├── parser/             [B2]  text → courses / groups / class sessions
│       │     types.ts  parse.ts  program.ts  index.ts
│       ├── timing/             [B3]  time bitmasks, conflict detection
│       │     constants.ts  mask.ts  build.ts  conflicts.ts  index.ts
│       └── solver/                   find the top-K schedules
│             [B4] types.ts  constants.ts  filter.ts  score.ts
│             [B5] equivalence.ts  search.ts  solve.ts  index.ts
│             [B6] protocol.ts  worker.ts
│
└── tests/
      [B2] fixtures/  (CO2001, CO2003, CO2007, CO2011, SK2001, SP1031 — real data, not manually typed)
      [B2] fixtureText.ts  parser.test.ts
      [B3] timing.test.ts
      [B5] solver.test.ts
      [B6] protocol.test.ts
```

## Sessions

| Session | Topic | Questions Answered |
|---|---|---|
| B1 | Initialization | Why run entirely on the client? Why separate the browser and Node configurations? |
| B2 | Parser | How is text from the course registration page parsed? Why return warnings instead of throwing errors? |
| B3 | Bitmask | Why 3360 bits? Why can time conflicts be detected using a simple AND operation? |
| B4 | Solver 1 | What is the difference between hard and soft constraints? How is a schedule scored? |
| B5 | Solver 2 | MRV, backtracking, forward checking, and relaxing requirements |
| B6 | Worker + UI + CI | Why is background processing necessary? How does the minimal UI call the solver? |


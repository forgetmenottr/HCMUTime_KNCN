import { describe, expect, it } from "vitest";
import {
  STATE_STORAGE_KEY,
  STATE_VERSION,
  buildPreferences,
  emptySavedState,
  initialPreferencesState,
  loadState,
  saveState,
  type SavedState,
  type StateStore,
} from "../src/model";

/** An in-memory stand-in for Web Storage. */
function memory(initial: Record<string, string> = {}): StateStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

const SAMPLE: SavedState = {
  program: "CC",
  choices: { dropped: ["SK2001"], locked: { CO2007: "CC01_CC01" }, excluded: ["CO2003:CC02_CC03"] },
};

describe("saving and loading", () => {
  it("round-trips the program and the step-2 choices under one versioned key", () => {
    const store = memory();
    saveState(store, SAMPLE);
    expect(Object.keys(store.data)).toEqual([STATE_STORAGE_KEY]);
    expect(JSON.parse(store.data[STATE_STORAGE_KEY]).v).toBe(STATE_VERSION);
    expect(loadState(store)).toEqual(SAMPLE);
  });

  it("nothing stored loads as an empty state", () => {
    expect(loadState(memory())).toEqual(emptySavedState());
    expect(loadState(null)).toEqual(emptySavedState());
    expect(loadState(undefined)).toEqual(emptySavedState());
  });
});

describe("corrupt, outdated or blocked storage falls back and never throws", () => {
  const cases: Record<string, string> = {
    "not JSON": "{oops",
    "a JSON string": '"hello"',
    "null": "null",
    "an array": "[1,2]",
    "another version": JSON.stringify({ v: STATE_VERSION + 1, ...SAMPLE }),
    "no version": JSON.stringify(SAMPLE),
  };
  for (const [name, text] of Object.entries(cases)) {
    it(`${name} → empty state`, () => {
      expect(loadState(memory({ [STATE_STORAGE_KEY]: text }))).toEqual(emptySavedState());
    });
  }

  it("keeps the valid fields of a half-broken object and drops the rest", () => {
    const text = JSON.stringify({
      v: STATE_VERSION,
      program: 42,
      choices: { dropped: ["CO2007", 7, "", "CO2007"], locked: { CO2011: "L01", CO2003: null }, excluded: ["CO2003:L01", "no-colon", {}, "CO2003:L01"] },
    });
    expect(loadState(memory({ [STATE_STORAGE_KEY]: text }))).toEqual({
      program: null,
      choices: { dropped: ["CO2007"], locked: { CO2011: "L01" }, excluded: ["CO2003:L01"] },
    });
  });

  it("a storage that throws on read or write is ignored", () => {
    const broken: StateStore = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(loadState(broken)).toEqual(emptySavedState());
    expect(() => saveState(broken, SAMPLE)).not.toThrow();
    expect(() => saveState(null, SAMPLE)).not.toThrow();
  });
});

describe("old whole-day selections can never reach daysOff (A3)", () => {
  // What an older version with a separate "Ngày nghỉ" control might have left behind.
  const legacy = {
    v: STATE_VERSION,
    program: "L",
    choices: { dropped: [], locked: {}, excluded: [], daysOff: [7, 8] },
    daysOff: { mode: "required", days: [7, 8] },
    preferences: { daysOff: { mode: "required", days: [7, 8] }, avoidLecturers: { mode: "off", names: ["Nguyễn Văn A"] } },
    avoidLecturers: { names: ["Nguyễn Văn A"] },
  };

  it("only the whitelisted fields are read back", () => {
    const loaded = loadState(memory({ [STATE_STORAGE_KEY]: JSON.stringify(legacy) }));
    expect(loaded).toEqual({ program: "L", choices: { dropped: [], locked: {}, excluded: [] } });
    expect(JSON.stringify(loaded)).not.toMatch(/daysOff|days|Nguyễn|avoidLecturers|preferences/);
  });

  it("the payload built after loading has daysOff off and empty, and no lecturer names", () => {
    const loaded = loadState(memory({ [STATE_STORAGE_KEY]: JSON.stringify(legacy) }));
    const p = buildPreferences(initialPreferencesState(loaded.program), { locked: loaded.choices.locked, excluded: loaded.choices.excluded })!;
    expect(p.daysOff).toEqual({ mode: "off", days: [] });
    expect(p.avoidLecturers).toEqual({ mode: "off", names: [] });
  });

  it("saving does not write anything that rode along on the object", () => {
    const store = memory();
    saveState(store, { ...SAMPLE, daysOff: { mode: "required", days: [7] } } as SavedState);
    expect(store.data[STATE_STORAGE_KEY]).not.toMatch(/daysOff/);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/lib/parser";
import { handleMessage, solve, type SolveRequest, type SolveResponse } from "../src/lib/solver";
import { buildMasks } from "../src/lib/timing";
import { buildPreferences, initialPreferencesState } from "../src/model";
import { SolveCancelled, createSolverClient, type WorkerLike } from "../src/solverClient";

const COURSES = buildMasks(
  ["CO2007", "CO2011"].flatMap((name) => parse(readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8")).courses),
).courses;
const PREFS = buildPreferences(initialPreferencesState("L"), { locked: {}, excluded: [] })!;
const keys = (r: { schedules: { picks: { group: { key: string } }[] }[] }) => r.schedules.map((s) => s.picks.map((p) => p.group.key));

describe("the worker's message handler", () => {
  it("answers a solve request with the result and the same id", () => {
    const response = handleMessage({ type: "solve", id: 7, courses: COURSES, prefs: PREFS });
    expect(response?.type).toBe("result");
    expect(response?.id).toBe(7);
    if (response?.type === "result") expect(keys(response.result)).toEqual(keys(solve(COURSES, PREFS)));
  });

  it("ignores anything that is not a request", () => {
    for (const junk of [null, undefined, "solve", 3, {}, { type: "other", id: 1 }, { type: "solve" }]) {
      expect(handleMessage(junk)).toBeNull();
    }
  });

  it("turns a thrown error into an error response instead of throwing", () => {
    const response = handleMessage({ type: "solve", id: 2, courses: [], prefs: PREFS }, () => {
      throw new Error("boom");
    });
    expect(response).toEqual({ type: "error", id: 2, message: "boom" });
  });

  it("the request and the result survive structured clone, as postMessage requires", () => {
    const request: SolveRequest = { type: "solve", id: 1, courses: COURSES, prefs: PREFS };
    const response = handleMessage(structuredClone(request))!;
    const copy = structuredClone(response);
    expect(copy.type).toBe("result");
    if (copy.type === "result" && response.type === "result") {
      expect(keys(copy.result)).toEqual(keys(response.result));
      expect(copy.result.schedules[0].picks[0].group.mask).toBeInstanceOf(Uint32Array);
    }
  });
});

// ---------------------------------------------------------------------------
// The client: a stand-in worker that behaves like the real one. It answers
// asynchronously, copies data through structured clone, and goes silent for
// good once terminated.
// ---------------------------------------------------------------------------

class FakeWorker implements WorkerLike {
  static created: FakeWorker[] = [];
  onmessage: ((event: { data: SolveResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  received = 0;
  /** When set, requests are kept and never answered: a solve that is still running. */
  hang = false;

  constructor() {
    FakeWorker.created.push(this);
  }

  postMessage(message: SolveRequest): void {
    if (this.terminated) throw new Error("posted to a terminated worker");
    this.received++;
    if (this.hang) return;
    const request = structuredClone(message);
    setTimeout(() => {
      if (this.terminated) return;
      const response = handleMessage(request);
      if (response) this.onmessage?.({ data: structuredClone(response) });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function setup(configure?: (w: FakeWorker, index: number) => void) {
  FakeWorker.created = [];
  const client = createSolverClient(() => {
    const w = new FakeWorker();
    configure?.(w, FakeWorker.created.length - 1);
    return w;
  });
  return { client, workers: FakeWorker.created };
}

describe("the solver client", () => {
  it("creates no worker until the first solve, then resolves with the result", async () => {
    const { client, workers } = setup();
    expect(workers).toHaveLength(0);
    const result = await client.solve(COURSES, PREFS);
    expect(keys(result)).toEqual(keys(solve(COURSES, PREFS)));
    expect(workers).toHaveLength(1);
    expect(client.busy).toBe(false);
  });

  it("reuses the same worker for the next solve after one finished", async () => {
    const { client, workers } = setup();
    await client.solve(COURSES, PREFS);
    await client.solve(COURSES, PREFS);
    expect(workers).toHaveLength(1);
    expect(workers[0].received).toBe(2);
    expect(workers[0].terminated).toBe(false);
  });

  it("cancel terminates the running worker, rejects with SolveCancelled, and the next solve works on a fresh worker", async () => {
    const { client, workers } = setup((w, i) => { w.hang = i === 0; });
    const first = client.solve(COURSES, PREFS);
    expect(client.busy).toBe(true);
    client.cancel();
    await expect(first).rejects.toBeInstanceOf(SolveCancelled);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].onmessage).toBeNull(); // nothing from the dead worker can reach the client
    expect(client.busy).toBe(false);

    const second = await client.solve(COURSES, PREFS);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
    expect(second.schedules.length).toBeGreaterThan(0);

    // And again: stop and start repeatedly.
    for (let round = 0; round < 3; round++) {
      const stopped = client.solve(COURSES, PREFS);
      client.cancel();
      await expect(stopped).rejects.toBeInstanceOf(SolveCancelled);
      expect((await client.solve(COURSES, PREFS)).schedules.length).toBeGreaterThan(0);
    }
    expect(workers.filter((w) => !w.terminated)).toHaveLength(1); // no worker is left behind
  });

  it("cancel with nothing running does nothing, and does not kill an idle worker", async () => {
    const { client, workers } = setup();
    client.cancel();
    await client.solve(COURSES, PREFS);
    client.cancel();
    expect(workers[0].terminated).toBe(false);
    await client.solve(COURSES, PREFS);
    expect(workers).toHaveLength(1);
  });

  it("a new solve while one is running replaces it: the old one is cancelled, the new one answers", async () => {
    const { client, workers } = setup((w, i) => { w.hang = i === 0; });
    const first = client.solve(COURSES, PREFS);
    const second = client.solve(COURSES, PREFS);
    await expect(first).rejects.toBeInstanceOf(SolveCancelled);
    expect((await second).schedules.length).toBeGreaterThan(0);
    expect(workers[0].terminated).toBe(true);
  });

  it("a worker crash rejects with an ordinary error, and the next solve gets a fresh worker", async () => {
    const { client, workers } = setup((w, i) => { w.hang = i === 0; });
    const first = client.solve(COURSES, PREFS);
    workers[0].onerror?.({ message: "script failed to load" });
    await expect(first).rejects.toThrow("script failed to load");
    await expect(first).rejects.not.toBeInstanceOf(SolveCancelled);
    expect(workers[0].terminated).toBe(true);
    expect((await client.solve(COURSES, PREFS)).schedules.length).toBeGreaterThan(0);
  });

  it("a worker that cannot be created rejects instead of throwing, and a later solve can still succeed", async () => {
    let fail = true;
    const client = createSolverClient(() => {
      if (fail) throw new Error("Worker is not defined");
      return new FakeWorker();
    });
    await expect(client.solve(COURSES, PREFS)).rejects.toThrow("Worker is not defined");
    expect(client.busy).toBe(false);
    fail = false;
    expect((await client.solve(COURSES, PREFS)).schedules.length).toBeGreaterThan(0);
  });
});

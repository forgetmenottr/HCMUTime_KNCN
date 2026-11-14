// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";
import { setLang } from "../src/i18n";
import { handleMessage } from "../src/lib/solver";
import { STATE_STORAGE_KEY, STATE_VERSION, type StateStore } from "../src/model";
import { SolveCancelled, createSolverClient, type SolverClient, type WorkerLike } from "../src/solverClient";

// ---------------------------------------------------------------------------
// One smoke test per screen, walking the real app in jsdom. The solver is the
// real client with a stand-in worker that runs the real `solve`, so everything
// except the browser's Worker itself is exercised.
// ---------------------------------------------------------------------------

// Read relative to the project root: under jsdom, import.meta.url is not a file URL.
const fixture = (...names: string[]) => names.map((n) => readFileSync(`tests/fixtures/${n}.txt`, "utf8")).join("\n");

function fakeSolver(): SolverClient {
  return createSolverClient(() => {
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: () => { worker.onmessage = null; },
      postMessage: (message) => {
        setTimeout(() => {
          const response = handleMessage(structuredClone(message));
          if (response) worker.onmessage?.({ data: response });
        }, 0);
      },
    };
    return worker;
  });
}

function memory(initial: Record<string, string> = {}): StateStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const pasteBox = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const paste = (text: string) => fireEvent.change(pasteBox(), { target: { value: text } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const currentStep = () => document.querySelector("main")!.getAttribute("data-step");

/** Steps 1 → 3 with the given courses pasted. */
function toPreferences(...names: string[]) {
  paste(fixture(...names));
  press(/Tiếp tục/);
  press(/Tiếp tục/);
  expect(currentStep()).toBe("prefs");
}

beforeEach(() => setLang("vi"));
afterEach(cleanup);

describe("step 1: paste", () => {
  it("blocks the way forward until a course is read, and says clearly which case it is", () => {
    render(<App solver={fakeSolver()} storage={null} />);
    const next = () => screen.getByRole("button", { name: /Tiếp tục/ }) as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    expect(screen.queryByTestId("paste-none")).toBeNull(); // an empty box is not an error

    paste("đây không phải dữ liệu đăng ký");
    expect(screen.getByTestId("paste-none").textContent).toContain("Không tìm thấy môn học nào trong nội dung đã dán.");
    expect(next().disabled).toBe(true);

    const lines = fixture("CO2007", "CO2011").split("\n");
    lines.splice(4, 0, "một dòng lạ");
    paste(lines.join("\n"));
    const ok = screen.getByTestId("paste-ok");
    expect(ok.textContent).toContain("Đọc được 2 môn");
    expect(ok.textContent).toContain("CO2007");
    expect(within(screen.getByTestId("paste-warnings")).getByRole("button", { name: "Dòng 5" })).toBeTruthy();
    expect(next().disabled).toBe(false);

    // "Dòng 5" selects that line in the box.
    press("Dòng 5");
    expect(pasteBox().value.slice(pasteBox().selectionStart, pasteBox().selectionEnd)).toBe("một dòng lạ");

    press("Xoá");
    expect(pasteBox().value).toBe("");
    expect(next().disabled).toBe(true);
  });

  it("the sample button fills the box with courses that parse", async () => {
    render(<App solver={fakeSolver()} storage={null} />);
    press("Thử với dữ liệu mẫu");
    await waitFor(() => expect(screen.getByTestId("paste-ok").textContent).toContain("Đọc được 3 môn"));
    expect(screen.queryByTestId("paste-warnings")).toBeNull();
  });
});

describe("step 2: courses and groups", () => {
  it("lists the courses, keeps lock and exclude apart, and saves the choices", () => {
    const store = memory();
    render(<App solver={fakeSolver()} storage={store} />);
    paste(fixture("CO2007", "CO2011"));
    press(/Tiếp tục/);
    expect(currentStep()).toBe("courses");
    expect(screen.getByTestId("credit-total").textContent).toBe("Tổng 7 tín chỉ");

    const card = document.querySelector<HTMLElement>("[data-course=CO2007]")!;
    fireEvent.click(within(card).getByRole("button", { expanded: false }));
    const rows = card.querySelectorAll<HTMLElement>("[data-group]");
    expect(rows).toHaveLength(5); // the first five, then "Xem thêm 13 nhóm"
    expect(within(card).getByRole("button", { name: "Xem thêm 13 nhóm" })).toBeTruthy();

    const id = rows[0].dataset.group!;
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Chỉ học lớp này" }));
    expect(card.textContent).toContain(`Chỉ học lớp này: ${id}`);
    fireEvent.click(within(rows[0]).getByRole("checkbox", { name: "Không học lớp này" }));
    expect(card.textContent).not.toContain(`Chỉ học lớp này: ${id}`); // excluding the locked group unlocks it

    // Unticking a course takes its credits out of the total.
    fireEvent.click(screen.getByRole("checkbox", { name: "Xếp lịch cho môn này: CO2011" }));
    expect(screen.getByTestId("credit-total").textContent).toBe("Tổng 4 tín chỉ");

    expect(JSON.parse(store.data[STATE_STORAGE_KEY])).toEqual({
      v: STATE_VERSION,
      program: null,
      choices: { dropped: ["CO2011"], locked: {}, excluded: [`CO2007:${id}`] },
    });
  });
});

describe("step 3: preferences", () => {
  it("needs a program before solving, shows the shares, and applies the first-tick and pause rules", () => {
    render(<App solver={fakeSolver()} storage={null} />);
    toPreferences("CO2007", "CO2011");
    const solveButton = () => screen.getByRole("button", { name: "Xếp lịch" }) as HTMLButtonElement;
    expect(solveButton().disabled).toBe(true);
    expect(screen.getByText("Chọn chương trình đào tạo của bạn")).toBeTruthy();
    expect(screen.getByTestId("share-fewerDays").textContent).toBe("63%");
    expect(screen.getByTestId("share-avoidEarly").textContent).toBe("37%");
    expect(screen.getByTestId("share-timeOfDay").textContent).toBe("—");

    fireEvent.click(screen.getByRole("radio", { name: "L" }));
    expect(solveButton().disabled).toBe(false);

    const modes = within(screen.getByTestId("mode-partsOff"));
    const checked = (name: string) => modes.getByRole("radio", { name }).getAttribute("aria-checked");
    expect(checked("Tắt")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Thứ 2, Sáng" }));
    expect(checked("Bắt buộc")).toBe("true"); // the first tick on an empty grid
    expect(screen.getByRole("checkbox", { name: "Thứ 2, Cả ngày" }).getAttribute("aria-checked")).toBe("mixed");

    fireEvent.click(modes.getByRole("radio", { name: "Ưu tiên" }));
    expect(screen.getByTestId("share-preferred").textContent).toBe("chiếm 38%");
    fireEvent.click(screen.getByRole("switch"));
    expect(checked("Tắt")).toBe("true");
    expect(screen.getByText("Đang tạm tắt (trước đó: Ưu tiên)")).toBeTruthy();
    expect(screen.queryByTestId("share-preferred")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(checked("Ưu tiên")).toBe("true");

    // Choosing a half-day moves the slider from 0 to 5.
    fireEvent.click(screen.getByRole("radio", { name: "Sáng" }));
    expect((document.getElementById("slider-timeOfDay") as HTMLInputElement).value).toBe("5");
  });

  it("puts the stepper inside the sentence, and English agrees the noun with it", () => {
    render(<App solver={fakeSolver()} storage={null} />);
    toPreferences("CO2007");
    const sentence = () => screen.getByTestId("top-k").textContent!.replace(/[−+]/g, " ").replace(/\s+/g, " ").trim();
    expect(sentence()).toBe("Hiển thị 5 phương án");
    press("English");
    expect(sentence()).toBe("Show 5 options");
    for (let i = 0; i < 4; i++) press("−");
    expect(sentence()).toBe("Show 1 option");
    expect((screen.getByRole("button", { name: "−" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores the remembered program", () => {
    const saved = { v: STATE_VERSION, program: "CC", choices: { dropped: [], locked: {}, excluded: [] } };
    render(<App solver={fakeSolver()} storage={memory({ [STATE_STORAGE_KEY]: JSON.stringify(saved) })} />);
    toPreferences("CO2007");
    expect(screen.getByRole("radio", { name: "CC" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("step 4: results", () => {
  async function solveWith(program: string, ...names: string[]) {
    toPreferences(...names);
    fireEvent.click(screen.getByRole("radio", { name: program }));
    press("Xếp lịch");
    expect(currentStep()).toBe("results");
    await waitFor(() => expect(screen.queryByTestId("solving")).toBeNull());
  }

  it("shows the options best first, the groups to register for, and the week grid; switching language re-renders only", async () => {
    render(<App solver={fakeSolver()} storage={null} />);
    await solveWith("L", "CO2001", "CO2003", "CO2007", "CO2011");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(tabs[0].textContent).toContain("Phương án 1");
    expect(tabs[0].textContent).toContain("Phù hợp nhất");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");

    const list = screen.getByTestId("register-list");
    for (const code of ["CO2001", "CO2003", "CO2007", "CO2011"]) expect(list.textContent).toContain(code);

    // The grid opens on "Tất cả": week 1 has no labs yet, so it would look like a schedule with pieces missing.
    expect(screen.getByRole("radio", { name: "Tất cả" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("week-label")).toBeNull();
    const blocks = () => document.querySelectorAll("[data-block]").length;
    const inAllWeeks = blocks();
    expect(inAllWeeks).toBeGreaterThan(0);
    // "Theo tuần" starts at the first week and shows no more blocks than all weeks together.
    fireEvent.click(screen.getByRole("radio", { name: "Theo tuần" }));
    expect(screen.getByTestId("week-label").textContent).toBe("Tuần 1");
    expect(blocks()).toBeGreaterThan(0);
    expect(blocks()).toBeLessThanOrEqual(inAllWeeks);

    const before = list.textContent;
    press("English");
    expect(screen.getAllByRole("tab")[0].textContent).toContain("Option 1");
    expect(screen.getByText("Groups to register for")).toBeTruthy();
    expect(screen.getByTestId("register-list").textContent?.replace(/Full/g, "Hết chỗ")).toBe(before); // same picks: nothing was solved again
  });

  it("a course outside the program is offered for dropping, and dropping it solves again", async () => {
    const store = memory();
    render(<App solver={fakeSolver()} storage={store} />);
    await solveWith("L", "CO2007", "SK2001");
    const box = screen.getByTestId("no-program");
    expect(box.textContent).toContain("Môn SK2001 không còn lớp nào thuộc chương trình L.");
    expect(box.textContent).toContain("Môn này chỉ còn lớp của chương trình A và CC.");
    expect(screen.queryByRole("tab")).toBeNull(); // the relaxed schedules of that run are not shown

    press("Bỏ môn này và xếp lại");
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(0));
    expect(screen.getByTestId("register-list").textContent).not.toContain("SK2001");
    expect(JSON.parse(store.data[STATE_STORAGE_KEY]).choices.dropped).toEqual(["SK2001"]);
  });

  it("required items that cannot be met give the banner and violation chips", async () => {
    render(<App solver={fakeSolver()} storage={null} />);
    toPreferences("CO2001", "CO2007");
    fireEvent.click(screen.getByRole("radio", { name: "L" }));
    fireEvent.click(within(screen.getByTestId("mode-freeSeats")).getByRole("radio", { name: "Bắt buộc" }));
    press("Xếp lịch");
    await waitFor(() => expect(screen.getByTestId("relaxed-banner")).toBeTruthy());
    expect(screen.getByTestId("relaxed-banner").textContent).toContain("Không có lịch nào đáp ứng đủ các mục Bắt buộc");
    // Only the student's own requirement is ever shown as broken: every option keeps CO2001 in its (full) L group.
    // No option may break the program (ui-change-analysis.md A4, generalised; tests/program-rule.test.ts).
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.textContent).toContain("Còn chỗ trống: CO2001");
      expect(tab.textContent).not.toContain("Chương trình đào tạo");
    }
    press("Chi tiết");
    expect(screen.getByTestId("relaxed-banner").textContent).toContain("Không lớp nào của môn CO2001");
  });

  it("while solving, Back stops the worker, and the next solve still works", async () => {
    // First solve never answers; later ones do.
    const real = fakeSolver();
    let calls = 0;
    let cancelled = 0;
    let rejectHanging: ((e: Error) => void) | null = null;
    const solver: SolverClient = {
      get busy() { return rejectHanging !== null || real.busy; },
      cancel: () => {
        cancelled++;
        rejectHanging?.(new SolveCancelled());
        rejectHanging = null;
        real.cancel();
      },
      solve: (courses, prefs) => (++calls === 1 ? new Promise((_, reject) => { rejectHanging = reject; }) : real.solve(courses, prefs)),
    };
    render(<App solver={solver} storage={null} />);
    toPreferences("CO2007", "CO2011");
    fireEvent.click(screen.getByRole("radio", { name: "L" }));
    press("Xếp lịch");
    expect(screen.getByTestId("solving").textContent).toContain("Đang xếp lịch…");

    press(/Quay lại/);
    expect(cancelled).toBeGreaterThan(0);
    expect(currentStep()).toBe("prefs");

    press("Xếp lịch");
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(0));
  });

  it("a worker failure shows the translated error with a retry that works", async () => {
    const real = fakeSolver();
    let calls = 0;
    const solver: SolverClient = {
      busy: false,
      cancel: () => real.cancel(),
      solve: (courses, prefs) => (++calls === 1 ? Promise.reject(new Error("worker failed")) : real.solve(courses, prefs)),
    };
    const quiet = console.error;
    console.error = () => {};
    try {
      render(<App solver={solver} storage={null} />);
      toPreferences("CO2007");
      fireEvent.click(screen.getByRole("radio", { name: "L" }));
      press("Xếp lịch");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Bộ xếp lịch gặp lỗi và không chạy được. Hãy thử lại."));
      press("Thử lại");
      await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(0));
    } finally {
      console.error = quiet;
    }
  });
});

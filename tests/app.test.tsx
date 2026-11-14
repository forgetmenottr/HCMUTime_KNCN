// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";
import { getLang, setLang } from "../src/i18n";
import type { SolverClient } from "../src/solverClient";

/** A solver that is never reached by these tests. */
const idleSolver: SolverClient = {
  busy: false,
  cancel: () => {},
  solve: () => new Promise(() => {}),
};

beforeEach(() => setLang("vi"));
afterEach(cleanup);

describe("the app shell", () => {
  it("shows the four steps by their Vietnamese names, with step 1 current and the later ones locked", () => {
    render(<App solver={idleSolver} storage={null} />);
    const steps = screen.getAllByRole("button", { name: /Dán dữ liệu|Môn và lớp|Mong muốn|Kết quả/ });
    expect(steps.map((b) => b.textContent)).toEqual(["1Dán dữ liệu", "2Môn và lớp", "3Mong muốn", "4Kết quả"]);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
    expect(steps.slice(1).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("switches language without reloading, and keeps <html lang> in step", async () => {
    render(<App solver={idleSolver} storage={null} />);
    expect(document.documentElement.lang).toBe("vi");
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(getLang()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: /Paste data/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Language" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    expect(document.documentElement.lang).toBe("vi");
  });
});

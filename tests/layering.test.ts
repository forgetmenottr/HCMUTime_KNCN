import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Layering of the source tree:
//
//   lib  ←  model  ←  screens (React, not built yet)        i18n sits beside model
//
// An arrow means "may import". `lib` is the bottom and knows nothing above it
// (tests/i18n.test.ts also checks lib against i18n, React and browser storage).
// `model` and `i18n` are pure layers that do not know each other, React or the
// browser; the screens use both.
// ---------------------------------------------------------------------------

/** Every .ts/.tsx file under src/<dir>, with comments removed so that prose cannot trip a check. */
function sources(dir: string): { name: string; code: string }[] {
  const root = new URL(`../src/${dir}/`, import.meta.url);
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => ({
      name: `${dir}/${name.replaceAll("\\", "/")}`,
      code: readFileSync(new URL(name.replaceAll("\\", "/"), root), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    }));
}

/** An import (static or dynamic) of `src/<layer>`, from anywhere below src. */
const importsLayer = (layer: string) => new RegExp(`(?:from\\s+|import\\s*\\(\\s*)["'](?:\\.\\./)+${layer}(?:/[^"']*)?["']`);

describe("layering", () => {
  it("finds the files it is meant to guard", () => {
    expect(sources("lib").length).toBeGreaterThan(10);
    expect(sources("model").length).toBeGreaterThan(0);
    expect(sources("i18n").length).toBeGreaterThan(5);
  });

  it("src/lib never imports src/model", () => {
    for (const { name, code } of sources("lib")) expect(code, name).not.toMatch(importsLayer("model"));
  });

  it("src/model imports only lib: no i18n, React, screens, or browser API", () => {
    for (const { name, code } of sources("model")) {
      expect(code, name).not.toMatch(importsLayer("i18n"));
      expect(code, name).not.toMatch(/from\s+["']react/);
      expect(code, name).not.toMatch(/from\s+["'](?:\.\.\/)+(?:screens|components|App)/);
      expect(code, name).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.|\bwindow\.|\bnavigator\./);
      // Every import that leaves the folder goes to lib; the rest stay inside model.
      for (const [, path] of code.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(path.startsWith("./") || path.startsWith("../lib/") || path === "../lib", `${name} imports ${path}`).toBe(true);
      }
    }
  });

  it("src/i18n never imports src/model, so the two pure layers stay independent", () => {
    for (const { name, code } of sources("i18n")) expect(code, name).not.toMatch(importsLayer("model"));
  });
});

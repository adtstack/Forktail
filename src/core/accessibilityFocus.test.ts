/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("accessibility focus styles", () => {
  it("keeps keyboard focus visible for controls and folder rows", () => {
    const controlFocusBlock = cssBlock("button:focus-visible,");
    expect(styles).toContain("input:focus-visible");
    expect(styles).toContain("select:focus-visible");
    expect(styles).toContain("[tabindex]:focus-visible");
    expect(controlFocusBlock).toContain("outline: 2px solid var(--focus-ring);");
    expect(controlFocusBlock).toContain("outline-offset: 2px;");
    expect(controlFocusBlock).toContain("box-shadow: 0 0 0 4px var(--focus-ring-shadow);");

    const folderRowFocusBlock = cssBlock(".folder-table tr:focus,");
    expect(folderRowFocusBlock).toContain("outline: 2px solid var(--focus-ring);");
    expect(folderRowFocusBlock).toContain("outline-offset: -2px;");
    expect(folderRowFocusBlock).toContain("box-shadow: inset 0 0 0 1px var(--focus-ring);");

    for (const [selector, requiredTokens] of [
      [":root", ["--focus-ring", "--focus-ring-shadow"]],
      ['.app-shell[data-theme="light"]', ["--focus-ring", "--focus-ring-shadow"]],
    ] as const) {
      const tokens = cssVariables(selector);
      for (const token of requiredTokens) {
        expect(tokens[token], `${selector} ${token}`).toBeTruthy();
      }
    }

    expect(styles).not.toMatch(/outline\s*:\s*none/i);
  });

  it("keeps the active 2-way diff hunk visible with line and gutter styles", () => {
    const activeDiffLineBlock = cssBlock(".active-diff-line");
    const activeDiffGlyphBlock = cssBlock(".active-diff-glyph");

    expect(activeDiffLineBlock).toContain("background: var(--active-diff-bg);");
    expect(activeDiffGlyphBlock).toContain("background: var(--active-diff-glyph);");
    expect(activeDiffGlyphBlock).toContain("width: 3px !important;");

    for (const selector of [":root", '.app-shell[data-theme="light"]'] as const) {
      const tokens = cssVariables(selector);
      expect(tokens["--active-diff-bg"], `${selector} --active-diff-bg`).toBeTruthy();
      expect(tokens["--active-diff-glyph"], `${selector} --active-diff-glyph`).toBeTruthy();
    }
  });

  it("keeps the active merge conflict visible with line and gutter styles", () => {
    const activeConflictLineBlock = cssBlock(".active-conflict-line");
    const activeConflictGlyphBlock = cssBlock(".active-conflict-glyph");

    expect(activeConflictLineBlock).toContain("background: var(--active-conflict-bg);");
    expect(activeConflictGlyphBlock).toContain("background: var(--active-conflict-glyph);");
    expect(activeConflictGlyphBlock).toContain("width: 3px !important;");

    for (const selector of [":root", '.app-shell[data-theme="light"]'] as const) {
      const tokens = cssVariables(selector);
      expect(tokens["--active-conflict-bg"], `${selector} --active-conflict-bg`).toBeTruthy();
      expect(tokens["--active-conflict-glyph"], `${selector} --active-conflict-glyph`).toBeTruthy();
    }
  });

  it("keeps the editor navigation status neutral and non-interactive", () => {
    const navigationStatus = cssBlock(".editor-navigation-status");
    expect(navigationStatus).toContain("background: var(--status-bg);");
    expect(navigationStatus).toContain("color: var(--toolbar-text);");
    expect(navigationStatus).toContain("pointer-events: none;");
  });

  it("keeps compare, merge, and scan controls available at a 200% zoom viewport", () => {
    const narrowViewport = cssBlock("@media (max-width: 900px)");

    for (const selector of [
      ".toolbar-check",
      ".toolbar-field",
      'aria-label="Merge options"',
      'aria-label="Scan options"',
      'aria-label="병합 옵션"',
      'aria-label="스캔 옵션"',
      ".option-bar",
    ]) {
      const hiddenControl = new RegExp(
        `${escapeRegExp(selector)}[^{}]*\\{[^{}]*display\\s*:\\s*none`,
        "i",
      );
      expect(narrowViewport).not.toMatch(hiddenControl);
    }

    expect(narrowViewport).toContain("overflow-y: auto;");
  });
});

function cssVariables(selector: string): Record<string, string> {
  const body = cssBlock(selector);
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
}

function cssBlock(selector: string): string {
  const selectorIndex = styles.indexOf(selector);
  if (selectorIndex < 0) throw new Error(`Missing CSS selector ${selector}`);
  const start = styles.indexOf("{", selectorIndex);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);

  let depth = 1;
  for (let index = start + 1; index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") {
      depth -= 1;
      if (depth === 0) return styles.slice(start + 1, index);
    }
  }
  throw new Error(`Unterminated CSS block for ${selector}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

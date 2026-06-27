/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;

const tokenPairs = [
  ["metadata-warning", "--metadata-warning-text", "--metadata-warning-bg"],
  ["toast error", "--toast-text", "--toast-error-bg"],
  ["toast success", "--toast-text", "--toast-success-bg"],
  ["warning chip", "--warning-chip-text", "--warning-chip-bg"],
  ["left chip", "--left-chip-text", "--left-chip-bg"],
  ["right chip", "--right-chip-text", "--right-chip-bg"],
  ["same chip", "--same-chip-text", "--same-chip-bg"],
  ["error chip", "--error-chip-text", "--error-chip-bg"],
  ["diff count", "--diff-count-text", "--diff-count-bg"],
  ["conflict count", "--conflict-count-text", "--conflict-count-bg"],
  ["clean count", "--clean-count-text", "--clean-count-bg"],
] as const;

describe("accessibility color contrast", () => {
  it("keeps dark and light status tokens at WCAG AA contrast", () => {
    const darkTokens = cssVariables(":root");
    const lightTokens = {
      ...darkTokens,
      ...cssVariables('.app-shell[data-theme="light"]'),
    };

    for (const [theme, tokens] of [
      ["dark", darkTokens],
      ["light", lightTokens],
    ] as const) {
      for (const [label, foregroundToken, backgroundToken] of tokenPairs) {
        const foreground = requiredToken(tokens, foregroundToken);
        const background = requiredToken(tokens, backgroundToken);
        expect(
          contrastRatio(foreground, background),
          `${theme} ${label} contrast ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT_RATIO);
      }
    }
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

function requiredToken(tokens: Record<string, string>, token: string): string {
  const value = tokens[token];
  if (!value) throw new Error(`Missing CSS token ${token}`);
  if (!/^#[\da-f]{6}$/i.test(value)) {
    throw new Error(`Expected six-digit hex color for ${token}, got ${value}`);
  }
  return value;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hexColor: string): number {
  const [red, green, blue] = hexToRgb(hexColor).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hexToRgb(hexColor: string): [number, number, number] {
  const value = Number.parseInt(hexColor.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

import type { LineEnding } from "./models";

export type SaveLineEndingMode = "original" | "system" | "lf" | "crlf";

export const SAVE_LINE_ENDING_MODES: SaveLineEndingMode[] = [
  "original",
  "system",
  "lf",
  "crlf",
];

export type LineEndingSequence = "\n" | "\r\n" | "\r";

export function textForSaveLineEnding(
  text: string,
  originalLineEnding: LineEnding,
  mode: SaveLineEndingMode,
  systemLineEnding: "\n" | "\r\n" = defaultSystemLineEnding(),
): string {
  const target = saveLineEndingSequence(originalLineEnding, mode, systemLineEnding);
  return target ? normalizeLineEndings(text, target) : text;
}

export function saveLineEndingSequence(
  originalLineEnding: LineEnding,
  mode: SaveLineEndingMode,
  systemLineEnding: "\n" | "\r\n" = defaultSystemLineEnding(),
): LineEndingSequence | null {
  if (mode === "lf") return "\n";
  if (mode === "crlf") return "\r\n";
  if (mode === "system") return systemLineEnding;
  if (originalLineEnding === "lf") return "\n";
  if (originalLineEnding === "crlf") return "\r\n";
  if (originalLineEnding === "cr") return "\r";
  return null;
}

export function defaultSystemLineEnding(): "\n" | "\r\n" {
  if (typeof navigator === "undefined") return "\n";
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  return /\bWin/i.test(platform) ? "\r\n" : "\n";
}

function normalizeLineEndings(text: string, target: LineEndingSequence): string {
  return text.replace(/\r\n|\r|\n/g, target);
}

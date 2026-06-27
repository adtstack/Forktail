export type WhitespaceCompareMode = "none" | "trim" | "all";

export interface TextDiffOptions {
  whitespace: WhitespaceCompareMode;
  ignoreCase: boolean;
  ignoreLineEndings: boolean;
}

export const DEFAULT_TEXT_DIFF_OPTIONS: TextDiffOptions = {
  whitespace: "none",
  ignoreCase: false,
  ignoreLineEndings: false,
};

export interface PreparedDiffTexts {
  left: string;
  right: string;
}

export function prepareDiffTexts(
  left: string,
  right: string,
  options: TextDiffOptions,
): PreparedDiffTexts {
  return {
    left: normalizeTextForDiff(left, options),
    right: normalizeTextForDiff(right, options),
  };
}

export function normalizeTextForDiff(text: string, options: TextDiffOptions): string {
  let normalized = options.ignoreLineEndings ? text.replace(/\r\n?/g, "\n") : text;

  if (options.whitespace === "trim") {
    normalized = normalized.replace(/[ \t\f\v]+(?=\r?\n|\r|$)/g, "");
  } else if (options.whitespace === "all") {
    normalized = normalized.replace(/[ \t\f\v]+/g, "");
  }

  if (options.ignoreCase) {
    normalized = normalized.toLocaleLowerCase();
  }

  return normalized;
}

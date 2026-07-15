import type { AppMode } from "./models";

export type CompareBackTarget = "home" | "folders" | "git";

export function modeAfterCompareBack(
  target: CompareBackTarget,
  hasFolderResult: boolean,
): AppMode {
  if (target === "git") return "git";
  return target === "folders" && hasFolderResult ? "folders" : "home";
}

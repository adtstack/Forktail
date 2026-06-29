import type { AppMode } from "./models";

export type CompareBackTarget = "home" | "folders";

export function modeAfterCompareBack(
  target: CompareBackTarget,
  hasFolderResult: boolean,
): AppMode {
  return target === "folders" && hasFolderResult ? "folders" : "home";
}

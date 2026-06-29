import { CORE_TEXT } from "./i18n";
import type { AppLanguage } from "./settings";

export type FinalNewlineDifference = "same" | "leftMissing" | "rightMissing";

export function finalNewlineLabel(
  hadFinalNewline: boolean,
  language: AppLanguage = "en",
): string {
  const text = CORE_TEXT[language];
  return hadFinalNewline ? text.finalNewline : text.noFinalNewline;
}

export function finalNewlineDifference(
  leftHadFinalNewline: boolean,
  rightHadFinalNewline: boolean,
): FinalNewlineDifference {
  if (leftHadFinalNewline === rightHadFinalNewline) return "same";
  return leftHadFinalNewline ? "rightMissing" : "leftMissing";
}

export function finalNewlineDifferenceLabel(
  difference: FinalNewlineDifference,
  language: AppLanguage = "en",
): string | null {
  const text = CORE_TEXT[language];
  switch (difference) {
    case "same":
      return null;
    case "leftMissing":
      return text.leftNoFinalNewline;
    case "rightMissing":
      return text.rightNoFinalNewline;
  }
}

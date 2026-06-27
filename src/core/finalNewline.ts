export type FinalNewlineDifference = "same" | "leftMissing" | "rightMissing";

export function finalNewlineLabel(hadFinalNewline: boolean): string {
  return hadFinalNewline ? "마지막 개행 있음" : "마지막 개행 없음";
}

export function finalNewlineDifference(
  leftHadFinalNewline: boolean,
  rightHadFinalNewline: boolean,
): FinalNewlineDifference {
  if (leftHadFinalNewline === rightHadFinalNewline) return "same";
  return leftHadFinalNewline ? "rightMissing" : "leftMissing";
}

export function finalNewlineDifferenceLabel(difference: FinalNewlineDifference): string | null {
  switch (difference) {
    case "same":
      return null;
    case "leftMissing":
      return "왼쪽 파일에 마지막 개행이 없습니다.";
    case "rightMissing":
      return "오른쪽 파일에 마지막 개행이 없습니다.";
  }
}

export type ConfirmLeave = (message: string) => boolean;

export const unsavedMergeNavigationMessage =
  "저장하지 않은 병합 결과가 있습니다. 변경 내용을 버리고 이동하시겠습니까?";

export const unsavedCompareNavigationMessage =
  "저장하지 않은 비교 파일 수정이 있습니다. 변경 내용을 버리고 이동하시겠습니까?";

export function hasUnsavedCompareChanges(
  currentRightText: string,
  savedRightSnapshot: string | null,
): boolean {
  return savedRightSnapshot != null && currentRightText !== savedRightSnapshot;
}

export function hasUnsavedMergeChanges(current: string, savedSnapshot: string | null): boolean {
  return savedSnapshot != null && current !== savedSnapshot;
}

export function canLeaveUnsavedMerge(
  current: string,
  savedSnapshot: string | null,
  confirmLeave: ConfirmLeave,
): boolean {
  if (!hasUnsavedMergeChanges(current, savedSnapshot)) return true;
  return confirmLeave(unsavedMergeNavigationMessage);
}

export function markBeforeUnloadIfUnsaved(
  event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">,
  message: string | null,
): boolean {
  if (!message) return false;
  event.preventDefault();
  event.returnValue = "";
  return true;
}

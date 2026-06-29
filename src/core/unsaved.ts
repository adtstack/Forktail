export type ConfirmLeave = (message: string) => boolean;

export const unsavedMergeNavigationMessage =
  "The merge result has unsaved changes. Discard them and leave?";

export const unsavedCompareNavigationMessage =
  "The compare file has unsaved changes. Discard them and leave?";

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

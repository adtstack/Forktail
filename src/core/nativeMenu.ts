import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  type CloseRequestedEvent,
} from "@tauri-apps/api/window";
import {
  dispatchAppCommand,
  isAppCommandAllowedForSurface,
  isAppCommandId,
} from "./commands";
import type { AppCommandId } from "./commands";
import { isTauriRuntime } from "./bridge";
import { isDetachedFolderReviewSurface } from "./detachedFolderReview";

export const NATIVE_MENU_COMMAND_EVENT = "forktail-menu-command";

export interface NativeWindowCloseGuardContext {
  approved: boolean;
  hasUnsavedChanges: boolean;
  requiresApplicationExit: boolean;
}

export type NativeWindowCloseRequestEvent = Pick<CloseRequestedEvent, "preventDefault">;

export function preventNativeWindowCloseWhenGuarded(
  event: NativeWindowCloseRequestEvent,
  context: NativeWindowCloseGuardContext,
  requestGuardedClose: () => void,
): boolean {
  if (
    context.approved
    || (!context.hasUnsavedChanges && !context.requiresApplicationExit)
  ) {
    return false;
  }

  event.preventDefault();
  requestGuardedClose();
  return true;
}

export async function listenForNativeWindowCloseRequests(
  handler: (event: NativeWindowCloseRequestEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return getCurrentWindow().onCloseRequested(handler);
}

export async function closeCurrentNativeWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  await getCurrentWindow().close();
}

export async function listenForNativeMenuCommands(): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;

  return listen<unknown>(NATIVE_MENU_COMMAND_EVENT, (event) => {
    if (
      isAppCommandId(event.payload)
      && isNativeMenuCommandAllowedForSurface(currentNativeMenuSurface(), event.payload)
    ) {
      dispatchAppCommand(
        event.payload,
        event.payload === "navigateEditorBack" ? "nativeMenu" : undefined,
        event.payload === "navigateEditorBack" && typeof performance !== "undefined"
          ? performance.now()
          : undefined,
      );
    }
  });
}

export type NativeMenuSurface = "main" | "folderReview";

export function isNativeMenuCommandAllowedForSurface(
  surface: NativeMenuSurface,
  commandId: AppCommandId,
): boolean {
  return isAppCommandAllowedForSurface(surface, commandId);
}

function currentNativeMenuSurface(): NativeMenuSurface {
  return typeof window !== "undefined" && isDetachedFolderReviewSurface(window.location.search)
    ? "folderReview"
    : "main";
}

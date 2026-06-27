import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { dispatchAppCommand, isAppCommandId } from "./commands";
import { isTauriRuntime } from "./bridge";

export const NATIVE_MENU_COMMAND_EVENT = "forktail-menu-command";

export async function listenForNativeMenuCommands(): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;

  return listen<unknown>(NATIVE_MENU_COMMAND_EVENT, (event) => {
    if (isAppCommandId(event.payload)) {
      dispatchAppCommand(event.payload);
    }
  });
}

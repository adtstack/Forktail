import {
  matchesCommandShortcut,
  type AppCommandSource,
  type KeyboardShortcutLike,
  type RuntimePlatform,
} from "./commands";

export const NAVIGATION_BACK_DEDUPE_MS = 80;

export interface NavigationKeyboardEvent extends KeyboardShortcutLike {
  timeStamp?: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export interface NavigationPointerEvent {
  button: number;
  timeStamp?: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export type NavigationBackDispatch = (
  source: AppCommandSource,
  monotonicEventTime?: number,
) => unknown;

interface PreviousInput {
  source: AppCommandSource;
  monotonicEventTime?: number;
}

export class NavigationBackInputRouter {
  private previous: PreviousInput | null = null;

  constructor(
    private readonly platform: RuntimePlatform,
    private readonly execute: NavigationBackDispatch,
  ) {}

  keydown(event: NavigationKeyboardEvent): boolean {
    if (event.defaultPrevented || !matchesCommandShortcut(
      "navigateEditorBack",
      event,
      this.platform,
    )) return false;
    event.preventDefault();
    this.dispatch("keyboard", normalizedTimestamp(event.timeStamp));
    return true;
  }

  pointerdown(event: NavigationPointerEvent): boolean {
    if (event.defaultPrevented || event.button !== 3) return false;
    event.preventDefault();
    this.dispatch("mouse", normalizedTimestamp(event.timeStamp));
    return true;
  }

  auxclick(event: NavigationPointerEvent): boolean {
    if (event.button !== 3) return false;
    if (!event.defaultPrevented) event.preventDefault();
    return true;
  }

  dispatch(source: AppCommandSource, monotonicEventTime?: number): boolean {
    const next = { source, monotonicEventTime };
    if (isCrossSourceDuplicate(this.previous, next)) {
      this.previous = next;
      return false;
    }
    this.previous = next;
    this.execute(source, monotonicEventTime);
    return true;
  }
}

export function isCrossSourceDuplicate(
  previous: PreviousInput | null,
  next: PreviousInput,
): boolean {
  if (!previous || previous.source === next.source) return false;
  if (previous.monotonicEventTime == null || next.monotonicEventTime == null) return false;
  return Math.abs(next.monotonicEventTime - previous.monotonicEventTime) <=
    NAVIGATION_BACK_DEDUPE_MS;
}

function normalizedTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

import { describe, expect, it, vi } from "vitest";
import {
  NavigationBackInputRouter,
  type NavigationKeyboardEvent,
  type NavigationPointerEvent,
} from "./navigationInput";

function keyboard(
  key: string,
  modifiers: Partial<NavigationKeyboardEvent> = {},
): NavigationKeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    timeStamp: 10,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...modifiers,
  };
}

function pointer(
  button: number,
  values: Partial<NavigationPointerEvent> = {},
): NavigationPointerEvent {
  return {
    button,
    timeStamp: 10,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...values,
  };
}

describe("NavigationBackInputRouter", () => {
  it("matches exact Windows/Linux Alt+Left and macOS Ctrl+-", () => {
    for (const platform of ["windows", "linux"] as const) {
      const dispatch = vi.fn();
      const router = new NavigationBackInputRouter(platform, dispatch);
      const accepted = keyboard("ArrowLeft", { altKey: true });
      expect(router.keydown(accepted)).toBe(true);
      expect(accepted.preventDefault).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledWith("keyboard", 10);
      expect(router.keydown(keyboard("ArrowLeft", { altKey: true, ctrlKey: true }))).toBe(false);
    }

    const dispatch = vi.fn();
    const mac = new NavigationBackInputRouter("macos", dispatch);
    expect(mac.keydown(keyboard("-", { ctrlKey: true }))).toBe(true);
    expect(mac.keydown(keyboard("-", { metaKey: true }))).toBe(false);
  });

  it("dispatches only pointerdown button 3 and blocks its auxclick default", () => {
    const dispatch = vi.fn();
    const router = new NavigationBackInputRouter("windows", dispatch);
    const backDown = pointer(3, { timeStamp: 100 });
    const backAux = pointer(3, { timeStamp: 101 });

    expect(router.pointerdown(backDown)).toBe(true);
    expect(backDown.preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(router.auxclick(backAux)).toBe(true);
    expect(backAux.preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(router.pointerdown(pointer(4))).toBe(false);
    expect(router.auxclick(pointer(4))).toBe(false);
  });

  it("deduplicates only cross-source events within 80ms with both timestamps", () => {
    const dispatch = vi.fn();
    const router = new NavigationBackInputRouter("windows", dispatch);

    expect(router.dispatch("mouse", 100)).toBe(true);
    expect(router.dispatch("nativeMenu", 180)).toBe(false);
    expect(router.dispatch("nativeMenu", 181)).toBe(true);
    expect(router.dispatch("nativeMenu", 200)).toBe(true);
    expect(router.dispatch("keyboard", undefined)).toBe(true);
    expect(router.dispatch("mouse", 205)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(5);
  });

  it("prevents an owned shortcut even when no restore is available", () => {
    const execute = vi.fn(() => "empty" as const);
    const router = new NavigationBackInputRouter("linux", execute);
    const event = keyboard("ArrowLeft", { altKey: true });

    expect(router.keydown(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("keyboard", 10);
  });

  it("does not expose a mousedown command adapter or screen onBack fallback", () => {
    const router = new NavigationBackInputRouter("linux", vi.fn());
    expect("mousedown" in router).toBe(false);
    expect("onBack" in router).toBe(false);
  });
});

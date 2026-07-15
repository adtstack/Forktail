import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mocks.close }),
}));

import { closeCurrentWindow } from "./bridge";

describe("desktop window lifecycle bridge", () => {
  afterEach(() => {
    mocks.close.mockClear();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("closes the current Tauri window so an external Git tool can continue", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });

    await closeCurrentWindow();

    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does not pretend to close a window outside the desktop runtime", async () => {
    await expect(closeCurrentWindow()).rejects.toThrow("Tauri desktop runtime");
    expect(mocks.close).not.toHaveBeenCalled();
  });
});

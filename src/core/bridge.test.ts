import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mocks.close }),
}));

import { closeCurrentWindow, gitToolExecutablePath } from "./bridge";

describe("desktop window lifecycle bridge", () => {
  afterEach(() => {
    mocks.close.mockClear();
    mocks.invoke.mockReset();
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

describe("Git tool executable path bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("requests the actual packaged executable path from the desktop runtime", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue("/Applications/forktail.app/Contents/MacOS/forktail");

    await expect(gitToolExecutablePath()).resolves.toBe(
      "/Applications/forktail.app/Contents/MacOS/forktail",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("git_tool_executable_path");
  });

  it("does not invent an executable path in browser or SSR contexts", async () => {
    await expect(gitToolExecutablePath()).rejects.toThrow("Tauri desktop runtime");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

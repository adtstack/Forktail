import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import {
  closeGitRepository,
  detectGitRepository,
  exitExternalGitTool,
  gitToolExecutablePath,
  openGitRevisionCompare,
} from "./bridge";
import type { GitRevisionCompareRequest } from "./gitModels";

describe("external Git tool lifecycle bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("terminates the desktop process so Git can continue on macOS too", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await exitExternalGitTool();

    expect(mocks.invoke).toHaveBeenCalledWith("exit_external_git_tool");
  });

  it("does not pretend to terminate outside the desktop runtime", async () => {
    await expect(exitExternalGitTool()).rejects.toThrow("Tauri desktop runtime");
    expect(mocks.invoke).not.toHaveBeenCalled();
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

describe("Git revision compare bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("passes only the typed repository operation request and job identity", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ repositoryId: "repository-session-1" });
    const leftRevision = {
      rawLabel: "main~1",
      resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
      kind: "symbolic" as const,
      displayName: "main~1",
    };
    const rightRevision = {
      rawLabel: "main",
      resolved: { algorithm: "sha1" as const, hex: "b".repeat(40) },
      kind: "branch" as const,
      displayName: "main",
    };
    const request = {
      leftRevision,
      rightRevision,
      changedFile: {
        status: "modified",
        oldPath: {
          opaqueId: "repository-session-1:path:4:1",
          displayPath: "src/file.txt",
          utf8Path: "src/file.txt",
        },
        newPath: {
          opaqueId: "repository-session-1:path:4:1",
          displayPath: "src/file.txt",
          utf8Path: "src/file.txt",
        },
        similarityScore: null,
      },
      generation: 4,
    } satisfies GitRevisionCompareRequest;

    await openGitRevisionCompare("repository-session-1", request, 73);

    expect(mocks.invoke).toHaveBeenCalledWith("open_git_revision_compare", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 73,
    });
  });
});

describe("Git repository lifecycle bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("validates a selected folder through the repository command", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ sessionId: "repository-session-8" });

    await detectGitRepository("/work/repository");

    expect(mocks.invoke).toHaveBeenCalledWith("detect_git_repository", {
      candidatePath: "/work/repository",
    });
  });

  it("closes only the opaque repository session", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await closeGitRepository("repository-session-8");

    expect(mocks.invoke).toHaveBeenCalledWith("close_git_repository", {
      repositorySessionId: "repository-session-8",
    });
  });
});

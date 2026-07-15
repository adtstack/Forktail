import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import {
  closeGitRepository,
  cancelGitJob,
  detectGitRepository,
  exitExternalGitTool,
  gitToolExecutablePath,
  listGitChangedFiles,
  listGitConflicts,
  listGitRefs,
  openGitIndexCompare,
  openGitRevisionCompare,
  openGitWorkingTreeCompare,
  readGitStatus,
  resolveGitRevision,
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

describe("Git revision selector bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("lists only typed local ref namespaces with a bounded job", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ refs: [], truncated: false });

    await listGitRefs(
      "repository-session-1",
      ["localBranch", "remoteTrackingBranch", "tag"],
      10_000,
      81,
    );

    expect(mocks.invoke).toHaveBeenCalledWith("list_git_refs", {
      repositorySessionId: "repository-session-1",
      kinds: ["localBranch", "remoteTrackingBranch", "tag"],
      hardLimit: 10_000,
      jobId: 81,
    });
  });

  it("resolves manual input with a stale-response generation and cancels typed jobs", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await resolveGitRevision("repository-session-1", "HEAD@{1}", 17);
    expect(mocks.invoke).toHaveBeenLastCalledWith("resolve_git_revision", {
      repositorySessionId: "repository-session-1",
      rawRevision: "HEAD@{1}",
      requestGeneration: 17,
    });

    await cancelGitJob("repository-session-1", 81);
    expect(mocks.invoke).toHaveBeenLastCalledWith("cancel_git_job", {
      repositorySessionId: "repository-session-1",
      jobId: 81,
    });
  });
});

describe("Git changed-file bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("lists one bounded immutable revision pair with a stale-response generation", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ entries: [], truncated: false, generation: 4 });
    const request = {
      leftCommit: { algorithm: "sha1" as const, hex: "a".repeat(40) },
      rightCommit: { algorithm: "sha1" as const, hex: "b".repeat(40) },
      hardLimit: 10_000,
      requestGeneration: 21,
    };

    await listGitChangedFiles("repository-session-1", request, 91);

    expect(mocks.invoke).toHaveBeenCalledWith("list_git_changed_files", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 91,
    });
  });
});

describe("Git working-tree status bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("reads one bounded status snapshot with a stale-response generation", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({
      staged: [],
      unstaged: [],
      untracked: [],
      unmerged: [],
      truncated: false,
      totalEntries: 0,
      generation: 5,
    });
    const request = { hardLimit: 10_000, requestGeneration: 22 };

    await readGitStatus("repository-session-1", request, 92);

    expect(mocks.invoke).toHaveBeenCalledWith("read_git_status", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 92,
    });
  });
});

describe("Git conflict discovery bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("lists bounded unmerged stage metadata without a mutation action", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({
      entries: [],
      operation: "unknown",
      truncated: false,
      totalEntries: 0,
      generation: 6,
    });
    const request = { hardLimit: 10_000, requestGeneration: 23 };

    await listGitConflicts("repository-session-1", request, 95);

    expect(mocks.invoke).toHaveBeenCalledWith("list_git_conflicts", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 95,
    });
  });
});

describe("Git working-tree compare bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("opens a resolved revision against one opaque disk path", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);
    const request = {
      revision: {
        rawLabel: "HEAD",
        resolved: { algorithm: "sha1" as const, hex: "a".repeat(40) },
        kind: "head" as const,
        displayName: "HEAD",
      },
      path: {
        opaqueId: "repository-session-1:path:5:2",
        displayPath: "src/file.txt",
        utf8Path: "src/file.txt",
      },
      generation: 5,
    };

    await openGitWorkingTreeCompare("repository-session-1", request, 93);

    expect(mocks.invoke).toHaveBeenCalledWith("open_git_working_tree_compare", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 93,
    });
  });
});

describe("Git index compare bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("opens one opaque path with an explicit three-state comparison", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);
    const request = {
      opaquePathId: "repository-session-1:path:5:2",
      comparison: "indexToWorkingTree" as const,
      generation: 5,
    };

    await openGitIndexCompare("repository-session-1", request, 94);

    expect(mocks.invoke).toHaveBeenCalledWith("open_git_index_compare", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 94,
    });
  });
});

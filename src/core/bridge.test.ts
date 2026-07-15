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
  getGitMergeBase,
  listGitChangedFiles,
  listGitConflicts,
  listGitFileHistory,
  listGitRefs,
  listGitRecentCommits,
  listGitTree,
  openGitConflict,
  openGitIndexCompare,
  openGitMergePreview,
  openGitRevisionCompare,
  openGitWorkingTreeCompare,
  readGitStatus,
  resolveGitRevision,
  saveGitConflictResult,
  statOptionalTextFileVersion,
  writeTextFileAtomic,
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

describe("guarded patch output bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("inspects an optional output and requests no-clobber creation when it was absent", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValueOnce(null).mockResolvedValueOnce({ path: "/exports/review.patch" });

    await expect(statOptionalTextFileVersion("/exports/review.patch")).resolves.toBeNull();
    await writeTextFileAtomic(
      "/exports/review.patch",
      "patch\n",
      true,
      null,
      "UTF-8",
      true,
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "stat_optional_text_file_version", {
      path: "/exports/review.patch",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "write_text_file_atomic_guarded", {
      path: "/exports/review.patch",
      text: "patch\n",
      createBackup: true,
      expectedSize: null,
      expectedModifiedMs: null,
      encoding: "UTF-8",
      expectedAbsent: true,
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

  it("lists bounded recent commit metadata from an immutable start commit", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ entries: [], truncated: false, shallow: false });
    const startCommit = { algorithm: "sha1" as const, hex: "a".repeat(40) };

    await listGitRecentCommits("repository-session-1", startCommit, 50, 82);

    expect(mocks.invoke).toHaveBeenCalledWith("list_git_recent_commits", {
      repositorySessionId: "repository-session-1",
      startCommit,
      hardLimit: 50,
      jobId: 82,
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

describe("Git file-history bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("requests bounded local metadata with opaque path identity and stale generation", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({
      entries: [],
      truncated: false,
      shallow: false,
      generation: 4,
    });
    const request = {
      startCommit: { algorithm: "sha1" as const, hex: "a".repeat(40) },
      opaquePathId: "repository-session-1:path:4:7",
      generation: 4,
      hardLimit: 50,
      requestGeneration: 19,
    };

    await listGitFileHistory("repository-session-1", request, 83);

    expect(mocks.invoke).toHaveBeenCalledWith("list_git_file_history", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 83,
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

describe("Git tree bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("loads one bounded immutable revision tree with an optional opaque prefix", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ entries: [], truncated: false, generation: 4 });
    const commit = { algorithm: "sha1" as const, hex: "a".repeat(40) };
    const pathPrefix = { opaqueId: "repository-session-1:path:4:1", generation: 4 };

    await listGitTree("repository-session-1", commit, pathPrefix, 100_000, 90);

    expect(mocks.invoke).toHaveBeenCalledWith("list_git_tree", {
      repositorySessionId: "repository-session-1",
      commit,
      pathPrefix,
      hardLimit: 100_000,
      jobId: 90,
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

describe("Git merge-base bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("passes only two immutable full commit identities and the cancellable job identity", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ kind: "none" });
    const request = {
      leftCommit: { algorithm: "sha1" as const, hex: "a".repeat(40) },
      rightCommit: { algorithm: "sha1" as const, hex: "b".repeat(40) },
    };

    await getGitMergeBase("repository-session-1", request, 98);

    expect(mocks.invoke).toHaveBeenCalledWith("get_git_merge_base", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 98,
    });
  });
});

describe("Git merge-preview bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("passes the selected base and immutable revision/file identities to one cancellable job", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);
    const objectId = { algorithm: "sha1" as const, hex: "a".repeat(40) };
    const path = { opaqueId: "repository-session-1:path:9:1", displayPath: "file.txt", utf8Path: "file.txt" };
    const request = {
      mergeBase: objectId,
      leftRevision: { rawLabel: "main", resolved: objectId, kind: "branch" as const, displayName: "main" },
      rightRevision: { rawLabel: "feature", resolved: { ...objectId, hex: "b".repeat(40) }, kind: "branch" as const, displayName: "feature" },
      changedFile: { status: "modified" as const, oldPath: path, newPath: path, similarityScore: null },
      generation: 9,
    };

    await openGitMergePreview("repository-session-1", request, 99);

    expect(mocks.invoke).toHaveBeenCalledWith("open_git_merge_preview", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 99,
    });
  });
});

describe("Git conflict session bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("opens one conflict using only its repository-scoped opaque path identity", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);
    const request = { opaquePathId: "repository-session-1:path:7:2", generation: 7 };

    await openGitConflict("repository-session-1", request, 96);

    expect(mocks.invoke).toHaveBeenCalledWith("open_git_conflict", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 96,
    });
  });
});

describe("Git conflict Result save bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("sends fingerprints and an opaque path without exposing a writable filesystem path", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);
    const request = {
      opaquePathId: "repository-session-1:path:7:2",
      generation: 7,
      expectedStageFingerprint: { stage1: null, stage2: null, stage3: null },
      expectedResultFingerprint: {
        kind: "regularFile" as const,
        size: 10,
        modifiedMs: 1234,
        contentHash: "a".repeat(64),
      },
      text: "resolved\n",
      encodingPolicy: "preserveResult" as const,
      lineEndingPolicy: "preserveResult" as const,
      createBackup: true,
      explicitOverwriteDecision: false,
    };

    await saveGitConflictResult("repository-session-1", request, 97);

    expect(mocks.invoke).toHaveBeenCalledWith("save_git_conflict_result", {
      repositorySessionId: "repository-session-1",
      request,
      jobId: 97,
    });
    expect(JSON.stringify(request)).not.toContain("/repo/");
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

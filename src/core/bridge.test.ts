import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class MockChannel<T> {
    onmessage?: (message: T) => void;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));

import {
  ackFolderScan,
  closeGitRepository,
  cancelGitJob,
  cancelFolderReviewTextRead,
  cancelFolderScan,
  chooseDirectory,
  chooseSavePath,
  chooseTextFile,
  detectGitRepository,
  exitExternalGitTool,
  gitToolExecutablePath,
  runtimeIntegrationProfile,
  nativeDialogDepthSnapshot,
  setEditorNavigationBackEnabled,
  setSettingsCommandEnabled,
  subscribeNativeDialogDepth,
  getGitMergeBase,
  listGitChangedFiles,
  listGitConflicts,
  listGitFileHistory,
  listGitRefs,
  listGitRecentCommits,
  listGitTree,
  loadDetachedFolderReview,
  openGitConflict,
  openGitIndexCompare,
  openGitMergePreview,
  openGitRevisionCompare,
  openGitWorkingTreeCompare,
  openDetachedFolderReview,
  invalidateDetachedFolderReviewSource,
  checkDetachedFolderReviewVersions,
  reloadDetachedFolderReview,
  readFolderReviewTextPair,
  readGitStatus,
  restoreTextFileBackup,
  resolveGitRevision,
  saveGitConflictResult,
  startFolderScan,
  statOptionalTextFileVersion,
  writeTextFileAtomic,
} from "./bridge";
import type { GitRevisionCompareRequest } from "./gitModels";
import type {
  FolderReviewTextPairRequest,
  FolderScanMessage,
  OpenDetachedFolderReviewRequest,
} from "./models";

describe("detached folder review bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("passes the resolved descriptor only from main open/invalidation calls", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ outcome: "created", windowLabel: "folder-review-1" });
    const request: OpenDetachedFolderReviewRequest = {
      sourceReviewToken: "review-7",
      scanGeneration: 3,
      leftRoot: "/left",
      rightRoot: "/right",
      relativePath: "src/main.rs",
      leftExpected: "regularFile",
      rightExpected: "missing",
    };

    await openDetachedFolderReview(request);
    await invalidateDetachedFolderReviewSource({
      sourceReviewToken: request.sourceReviewToken,
      scanGeneration: request.scanGeneration,
    });

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "open_detached_folder_review", { request });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "invalidate_detached_folder_review_source",
      { request: { sourceReviewToken: "review-7", scanGeneration: 3 } },
    );
  });

  it("keeps child commands argument-free and caller-label-bound", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await loadDetachedFolderReview();
    await checkDetachedFolderReviewVersions();
    await reloadDetachedFolderReview();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "load_detached_folder_review");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "check_detached_folder_review_versions");
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "reload_detached_folder_review");
  });
});

describe("progressive folder scan bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("buffers early Channel messages until the native job identity is installed", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    const message: FolderScanMessage = {
      event: "progress",
      jobId: 41,
      scanGeneration: 3,
      sequence: 1,
      data: {
        phase: "inventory",
        discovered: 1,
        finalized: 0,
        pending: 1,
        errors: 0,
        hashedFiles: 0,
        hashCandidates: null,
      },
    };
    let identityInstalled = false;
    mocks.invoke.mockImplementationOnce(async (command, args) => {
      expect(command).toBe("start_folder_scan");
      const channel = (args as { onEvent: { onmessage?: (value: FolderScanMessage) => void } })
        .onEvent;
      channel.onmessage?.(message);
      return {
        jobId: 41,
        scanGeneration: 3,
        leftRoot: "/left",
        rightRoot: "/right",
        optionsFingerprint: "metadata:0:0:0",
      };
    });
    const received: FolderScanMessage[] = [];

    await startFolderScan(
      {
        scanGeneration: 3,
        leftRoot: "/left",
        rightRoot: "/right",
        options: {
          compareMode: "metadata",
          includeHidden: false,
          respectGitignore: false,
          followSymlinks: false,
        },
      },
      (value) => {
        expect(identityInstalled).toBe(true);
        received.push(value);
      },
      () => { identityInstalled = true; },
    );

    expect(received).toEqual([message]);
  });

  it("sends cumulative acknowledgement and generation-aware cancellation", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await ackFolderScan({ jobId: 41, scanGeneration: 3, appliedThroughSequence: 7 });
    await cancelFolderScan(41, 3);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "ack_folder_scan", {
      ack: { jobId: 41, scanGeneration: 3, appliedThroughSequence: 7 },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "cancel_folder_scan", {
      jobId: 41,
      scanGeneration: 3,
    });
  });
});

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

  it("loads one authoritative runtime platform and executable profile", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({
      platform: "macos",
      executablePath: "/Applications/forktail.app/Contents/MacOS/forktail",
      detection: "detected",
    });

    await expect(runtimeIntegrationProfile()).resolves.toEqual({
      platform: "macos",
      executablePath: "/Applications/forktail.app/Contents/MacOS/forktail",
      detection: "detected",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("runtime_integration_profile");
  });
});

describe("editor navigation native bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    mocks.open.mockReset();
    mocks.save.mockReset();
    Reflect.deleteProperty(globalThis, "window");
    expect(nativeDialogDepthSnapshot()).toBe(0);
  });

  it("sends only a boolean native menu capability", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await setEditorNavigationBackEnabled(true);
    await setEditorNavigationBackEnabled(false);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "set_editor_navigation_back_enabled", {
      enabled: true,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "set_editor_navigation_back_enabled", {
      enabled: false,
    });
  });

  it("rejects setter failures so App can fail closed", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockRejectedValue(new Error("menu unavailable"));

    await expect(setEditorNavigationBackEnabled(true)).rejects.toThrow("menu unavailable");
  });

  it("sends only a boolean Settings menu capability", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await setSettingsCommandEnabled(true);
    await setSettingsCommandEnabled(false);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "set_settings_command_enabled", {
      enabled: true,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "set_settings_command_enabled", {
      enabled: false,
    });
  });

  it("tracks nested native dialogs and recovers on cancel and rejection", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    const depthChanges: number[] = [];
    const unsubscribe = subscribeNativeDialogDepth((depth) => { depthChanges.push(depth); });
    let resolveOpen!: (value: string | null) => void;
    mocks.open
      .mockImplementationOnce(() => new Promise<string | null>((resolve) => { resolveOpen = resolve; }))
      .mockRejectedValueOnce(new Error("chooser failed"));
    mocks.save.mockResolvedValueOnce(null);

    const first = chooseTextFile("Choose file");
    expect(nativeDialogDepthSnapshot()).toBe(1);
    const second = chooseSavePath(undefined, "Save file");
    expect(nativeDialogDepthSnapshot()).toBe(2);
    await expect(second).resolves.toBeNull();
    expect(nativeDialogDepthSnapshot()).toBe(1);
    resolveOpen(null);
    await expect(first).resolves.toBeNull();
    expect(nativeDialogDepthSnapshot()).toBe(0);
    await expect(chooseDirectory("Choose folder")).rejects.toThrow("chooser failed");
    expect(nativeDialogDepthSnapshot()).toBe(0);
    unsubscribe();

    expect(depthChanges).toEqual([1, 2, 1, 0, 1, 0]);
  });
});

describe("folder review text pair bridge", () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("passes one typed all-or-nothing pair request and a caller-owned job id", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ left: { text: "left" }, right: null });
    const request = {
      leftRoot: "/review/left",
      rightRoot: "/review/right",
      relativePath: "src/App.tsx",
      leftExpected: "regularFile",
      rightExpected: "missing",
    } satisfies FolderReviewTextPairRequest;

    await readFolderReviewTextPair(request, 91);

    expect(mocks.invoke).toHaveBeenCalledWith("read_folder_review_text_pair", {
      request,
      jobId: 91,
    });
  });

  it("uses an idempotent cancellation command without path or content payload", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue(undefined);

    await cancelFolderReviewTextRead(91);

    expect(mocks.invoke).toHaveBeenCalledWith("cancel_folder_review_text_read", { jobId: 91 });
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
      expectedContentHash: null,
      encoding: "UTF-8",
    });
  });

  it("passes the opened byte hash to overwrite and backup-restore preconditions", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __TAURI_INTERNALS__: {} },
    });
    mocks.invoke.mockResolvedValue({ path: "/repo/right.txt" });
    const precondition = {
      expectedSize: 12,
      expectedModifiedMs: 1_700_000_000_000,
      expectedContentHash: "opened-content-hash",
    };

    await writeTextFileAtomic(
      "/repo/right.txt",
      "replacement\n",
      true,
      precondition,
      "UTF-8",
    );
    await restoreTextFileBackup(
      "/repo/right.txt",
      "/repo/right.txt.bak.1",
      precondition,
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "write_text_file_atomic", {
      path: "/repo/right.txt",
      text: "replacement\n",
      createBackup: true,
      expectedSize: 12,
      expectedModifiedMs: 1_700_000_000_000,
      expectedContentHash: "opened-content-hash",
      encoding: "UTF-8",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "restore_text_file_backup", {
      path: "/repo/right.txt",
      backupPath: "/repo/right.txt.bak.1",
      expectedSize: 12,
      expectedModifiedMs: 1_700_000_000_000,
      expectedContentHash: "opened-content-hash",
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

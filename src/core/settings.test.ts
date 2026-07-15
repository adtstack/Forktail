import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_COMPARE_VIEW_SETTINGS,
  DEFAULT_FOLDER_SCAN_OPTIONS,
  DEFAULT_FOLDER_VIEW_SETTINGS,
  DEFAULT_MERGE_SETTINGS,
  MAX_RECENT_SESSIONS,
  loadAppearanceSettings,
  loadActiveSession,
  loadCompareViewSettings,
  loadFolderScanOptions,
  loadFolderViewSettings,
  loadMergeSettings,
  loadRecentSessions,
  persistentMergeSessionInput,
  persistentCompareSessionInput,
  removeLegacyMergetoolRecentSession,
  removeRecentSession,
  sanitizeActiveSession,
  sanitizeAppearanceSettings,
  sanitizeCompareViewSettings,
  sanitizeFolderScanOptions,
  sanitizeFolderViewSettings,
  sanitizeMergeSettings,
  sanitizeRecentSessions,
  saveAppearanceSettings,
  saveActiveSession,
  saveCompareViewSettings,
  saveFolderScanOptions,
  saveFolderViewSettings,
  saveMergeSettings,
  saveRecentSessions,
  upsertRecentSession,
  type AppearanceSettings,
  type ActiveSession,
  type CompareViewSettings,
  type FolderViewSettings,
  type MergeSettings,
  type RecentSession,
} from "./settings";
import type { CompareSession, FileDocument, MergeSession } from "./models";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("appearance settings", () => {
  it("falls back to defaults when storage is empty or invalid", () => {
    const storage = new MemoryStorage();

    expect(loadAppearanceSettings(storage)).toEqual(DEFAULT_APPEARANCE_SETTINGS);
    storage.setItem("forktail.appearance.v1", "{");
    expect(loadAppearanceSettings(storage)).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it("persists and sanitizes theme mode", () => {
    const storage = new MemoryStorage();
    const settings: AppearanceSettings = { language: "ko", theme: "light" };

    saveAppearanceSettings(settings, storage);

    expect(loadAppearanceSettings(storage)).toEqual(settings);
    expect(sanitizeAppearanceSettings({ language: "fr", theme: "high-contrast" })).toEqual(
      DEFAULT_APPEARANCE_SETTINGS,
    );
    expect(sanitizeAppearanceSettings({ theme: "dark" })).toEqual({
      language: DEFAULT_APPEARANCE_SETTINGS.language,
      theme: "dark",
    });
  });
});

describe("compare view settings", () => {
  it("falls back to defaults when storage is empty or invalid", () => {
    const storage = new MemoryStorage();

    expect(loadCompareViewSettings(storage)).toEqual(DEFAULT_COMPARE_VIEW_SETTINGS);
    storage.setItem("forktail.compare-view.v1", "{");
    expect(loadCompareViewSettings(storage)).toEqual(DEFAULT_COMPARE_VIEW_SETTINGS);
  });

  it("persists only diff and view options", () => {
    const storage = new MemoryStorage();
    const settings: CompareViewSettings = {
      diffOptions: { whitespace: "all", ignoreCase: true, ignoreLineEndings: true },
      renderWhitespace: "all",
      saveLineEnding: "crlf",
      sideBySide: false,
      wordWrap: "on",
      wrapAround: false,
    };

    saveCompareViewSettings(settings, storage);

    expect(loadCompareViewSettings(storage)).toEqual(settings);
    const raw = storage.getItem("forktail.compare-view.v1") ?? "";
    expect(raw).not.toContain("file contents");
    expect(raw).not.toContain("path");
  });

  it("sanitizes malformed compare settings", () => {
    expect(
      sanitizeCompareViewSettings({
        diffOptions: { whitespace: "unknown", ignoreCase: "yes" },
        renderWhitespace: "boundary",
        saveLineEnding: "native",
        sideBySide: "no",
        wordWrap: "on",
        wrapAround: false,
      }),
    ).toEqual({
      diffOptions: DEFAULT_COMPARE_VIEW_SETTINGS.diffOptions,
      renderWhitespace: "selection",
      saveLineEnding: "original",
      sideBySide: true,
      wordWrap: "on",
      wrapAround: false,
    });
  });
});

describe("folder scan options", () => {
  it("falls back to defaults when storage is empty or invalid", () => {
    const storage = new MemoryStorage();

    expect(loadFolderScanOptions(storage)).toEqual(DEFAULT_FOLDER_SCAN_OPTIONS);
    storage.setItem("forktail.folder-scan-options.v1", "{");
    expect(loadFolderScanOptions(storage)).toEqual(DEFAULT_FOLDER_SCAN_OPTIONS);
  });

  it("persists and sanitizes scan options", () => {
    const storage = new MemoryStorage();
    const options = {
      compareMode: "fullHash" as const,
      includeHidden: true,
      respectGitignore: true,
      followSymlinks: true,
    };

    saveFolderScanOptions(options, storage);

    expect(loadFolderScanOptions(storage)).toEqual(options);
    expect(
      sanitizeFolderScanOptions({
        compareMode: "unknown",
        includeHidden: "yes",
        respectGitignore: true,
      }),
    ).toEqual({
      ...DEFAULT_FOLDER_SCAN_OPTIONS,
      respectGitignore: true,
    });
  });
});

describe("folder view settings", () => {
  it("falls back to defaults when storage is empty or invalid", () => {
    const storage = new MemoryStorage();

    expect(loadFolderViewSettings(storage)).toEqual(DEFAULT_FOLDER_VIEW_SETTINGS);
    storage.setItem("forktail.folder-view.v1", "{");
    expect(loadFolderViewSettings(storage)).toEqual(DEFAULT_FOLDER_VIEW_SETTINGS);
  });

  it("persists only status filters and sort options", () => {
    const storage = new MemoryStorage();
    const settings: FolderViewSettings = {
      statusFilters: {
        same: true,
        different: false,
        leftOnly: true,
        rightOnly: false,
        typeMismatch: true,
        error: true,
      },
      sort: { key: "modified", direction: "desc" },
    };

    saveFolderViewSettings(settings, storage);

    expect(loadFolderViewSettings(storage)).toEqual(settings);
    expect(storage.getItem("forktail.folder-view.v1")).not.toContain("query");
  });

  it("sanitizes missing and unknown values", () => {
    expect(
      sanitizeFolderViewSettings({
        statusFilters: { same: true, different: "yes" },
        sort: { key: "unknown", direction: "sideways" },
      }),
    ).toEqual({
      statusFilters: {
        ...DEFAULT_FOLDER_VIEW_SETTINGS.statusFilters,
        same: true,
      },
      sort: { key: "path", direction: "asc" },
    });
  });
});

describe("merge settings", () => {
  it("falls back to defaults when storage is empty or invalid", () => {
    const storage = new MemoryStorage();

    expect(loadMergeSettings(storage)).toEqual(DEFAULT_MERGE_SETTINGS);
    storage.setItem("forktail.merge-settings.v1", "{");
    expect(loadMergeSettings(storage)).toEqual(DEFAULT_MERGE_SETTINGS);
  });

  it("persists and sanitizes merge settings", () => {
    const storage = new MemoryStorage();
    const settings: MergeSettings = {
      autoAdvanceConflict: false,
      recoveryDraftsEnabled: true,
      saveLineEnding: "lf",
    };

    saveMergeSettings(settings, storage);

    expect(loadMergeSettings(storage)).toEqual(settings);
    expect(sanitizeMergeSettings({
      autoAdvanceConflict: "yes",
      recoveryDraftsEnabled: true,
      saveLineEnding: "native",
    }))
      .toEqual({
        ...DEFAULT_MERGE_SETTINGS,
        recoveryDraftsEnabled: true,
      });
  });
});

describe("recent sessions", () => {
  it("falls back to an empty list when storage is empty or invalid", () => {
    const storage = new MemoryStorage();

    expect(loadRecentSessions(storage)).toEqual([]);
    storage.setItem("forktail.recent-sessions.v1", "{");
    expect(loadRecentSessions(storage)).toEqual([]);
  });

  it("stores only paths, options, and timestamps", () => {
    const storage = new MemoryStorage();
    const sessions = upsertRecentSession([], {
      kind: "compare",
      leftPath: "/work/left.txt",
      rightPath: "/work/right.txt",
    }, 1000);

    saveRecentSessions(sessions, storage);

    expect(loadRecentSessions(storage)).toEqual(sessions);
    const raw = storage.getItem("forktail.recent-sessions.v1") ?? "";
    expect(raw).toContain("/work/left.txt");
    expect(raw).not.toContain("left file contents");
    expect(raw).not.toContain("text");
  });

  it("deduplicates by session identity and keeps the newest timestamp", () => {
    const first = upsertRecentSession([], {
      kind: "merge",
      basePath: "/repo/base.ts",
      oursPath: "/repo/ours.ts",
      theirsPath: "/repo/theirs.ts",
      outputPath: null,
    }, 1000);
    const second = upsertRecentSession(first, {
      kind: "merge",
      basePath: "/repo/base.ts",
      oursPath: "/repo/ours.ts",
      theirsPath: "/repo/theirs.ts",
      outputPath: null,
    }, 2000);

    expect(second).toHaveLength(1);
    expect(second[0].updatedAt).toBe(2000);
  });

  it("keeps at most twenty recent sessions in newest-first order", () => {
    let sessions: RecentSession[] = [];
    for (let index = 0; index < MAX_RECENT_SESSIONS + 5; index += 1) {
      sessions = upsertRecentSession(sessions, {
        kind: "compare",
        leftPath: `/left/${index}.txt`,
        rightPath: `/right/${index}.txt`,
      }, index + 1);
    }

    expect(sessions).toHaveLength(MAX_RECENT_SESSIONS);
    expect(sessions[0]).toMatchObject({ leftPath: "/left/24.txt" });
    expect(sessions.at(-1)).toMatchObject({ leftPath: "/left/5.txt" });
  });

  it("removes a specific recent session by stable identity", () => {
    const compare = upsertRecentSession([], {
      kind: "compare",
      leftPath: "/left/a.txt",
      rightPath: "/right/a.txt",
    }, 1000);
    const sessions = upsertRecentSession(compare, {
      kind: "folders",
      leftRoot: "/left",
      rightRoot: "/right",
      options: DEFAULT_FOLDER_SCAN_OPTIONS,
    }, 2000);

    const next = removeRecentSession(sessions, compare[0].id);

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: "folders", leftRoot: "/left", rightRoot: "/right" });
  });

  it("sanitizes malformed recent sessions", () => {
    expect(
      sanitizeRecentSessions([
        { kind: "compare", leftPath: " ", rightPath: "/right.txt", updatedAt: 1 },
        {
          kind: "folders",
          leftRoot: "/left",
          rightRoot: "/right",
          options: { compareMode: "unknown", includeHidden: true, followSymlinks: "yes" },
          updatedAt: 2,
        },
      ]),
    ).toEqual([
      {
        id: "folders\n/left\n/right\nquickHash\nhidden\nall\nnofollow",
        kind: "folders",
        leftRoot: "/left",
        rightRoot: "/right",
        options: {
          compareMode: "quickHash",
          includeHidden: true,
          respectGitignore: false,
          followSymlinks: false,
        },
        updatedAt: 2,
      },
    ]);
  });
});

describe("active session restore settings", () => {
  it("persists only active session paths and options", () => {
    const storage = new MemoryStorage();
    const session: ActiveSession = {
      kind: "merge",
      basePath: "/repo/base.ts",
      oursPath: "/repo/ours.ts",
      theirsPath: "/repo/theirs.ts",
      outputPath: "/repo/result.ts",
    };

    saveActiveSession(session, storage);

    expect(loadActiveSession(storage)).toEqual(session);
    const raw = storage.getItem("forktail.active-session.v1") ?? "";
    expect(raw).toContain("/repo/base.ts");
    expect(raw).not.toContain("base file contents");
    expect(raw).not.toContain("result draft");
    expect(raw).not.toContain("text");
  });

  it("clears and sanitizes active sessions", () => {
    const storage = new MemoryStorage();
    saveActiveSession({
      kind: "compare",
      leftPath: "/left.txt",
      rightPath: "/right.txt",
    }, storage);

    saveActiveSession(null, storage);

    expect(loadActiveSession(storage)).toBeNull();
    expect(sanitizeActiveSession({
      kind: "folders",
      leftRoot: "/left",
      rightRoot: "/right",
      options: { compareMode: "unknown", includeHidden: true },
    })).toEqual({
      kind: "folders",
      leftRoot: "/left",
      rightRoot: "/right",
      options: {
        ...DEFAULT_FOLDER_SCAN_OPTIONS,
        includeHidden: true,
      },
    });
  });

  it("does not convert mergetool temporary paths into a persistent session", () => {
    const storage = new MemoryStorage();
    const session: MergeSession = {
      origin: "mergetool",
      base: testDocument("/tmp/git/base.txt"),
      ours: testDocument("/tmp/git/local.txt"),
      theirs: testDocument("/tmp/git/remote.txt"),
      output: testDocument("/repo/merged.txt"),
      result: "resolved\n",
      outputPath: "/repo/merged.txt",
    };

    saveActiveSession({
      kind: "merge",
      basePath: session.base.path,
      oursPath: session.ours.path,
      theirsPath: session.theirs.path,
      outputPath: session.outputPath,
    }, storage);
    expect(storage.getItem("forktail.active-session.v1")).toContain("/tmp/git/");

    const persistent = persistentMergeSessionInput(session);
    expect(persistent).toBeNull();
    saveActiveSession(persistent, storage);
    saveRecentSessions([], storage);

    const serialized = [
      storage.getItem("forktail.active-session.v1"),
      storage.getItem("forktail.recent-sessions.v1"),
    ].join("\n");
    expect(serialized).not.toContain("/tmp/git/");
    expect(serialized).not.toContain("/repo/merged.txt");
  });

  it("does not convert difftool temporary paths into a persistent session", () => {
    const storage = new MemoryStorage();
    const session: CompareSession = {
      origin: "difftool",
      left: testDocument("/tmp/git/LOCAL"),
      right: testDocument("/tmp/git/REMOTE"),
    };

    expect(persistentCompareSessionInput(session)).toBeNull();
    saveActiveSession(null, storage);
    saveRecentSessions([], storage);

    const serialized = [
      storage.getItem("forktail.active-session.v1"),
      storage.getItem("forktail.recent-sessions.v1"),
    ].join("\n");
    expect(serialized).not.toContain("/tmp/git/");
  });

  it("purges a legacy recent entry that contains the current mergetool paths", () => {
    const storage = new MemoryStorage();
    const legacy = upsertRecentSession([], {
      kind: "merge",
      basePath: "/tmp/git/base.txt",
      oursPath: "/tmp/git/local.txt",
      theirsPath: "/tmp/git/remote.txt",
      outputPath: "/repo/merged.txt",
    }, 1000);
    const kept = upsertRecentSession(legacy, {
      kind: "compare",
      leftPath: "/repo/left.txt",
      rightPath: "/repo/right.txt",
    }, 2000);

    const cleaned = removeLegacyMergetoolRecentSession(kept, {
      basePath: "/tmp/git/base.txt",
      oursPath: "/tmp/git/local.txt",
      theirsPath: "/tmp/git/remote.txt",
      outputPath: "/repo/merged.txt",
    });
    saveRecentSessions(cleaned, storage);

    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toMatchObject({ kind: "compare" });
    expect(storage.getItem("forktail.recent-sessions.v1")).not.toContain("/tmp/git/");
  });
});

function testDocument(path: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text: "",
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: true,
    size: 0,
    modifiedMs: 1000,
    isBinary: false,
    decodeHadErrors: false,
  };
}

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FOLDER_SCAN_OPTIONS,
  type AppLanguage,
  type RecentSession,
  type ThemeMode,
} from "../core/settings";
import { focusStartPageSettingsDestination, StartPage } from "./StartPage";

const compareRecentSession: RecentSession = {
  id: "compare:/missing/left.txt\n/missing/right.txt",
  kind: "compare",
  leftPath: "/missing/left.txt",
  rightPath: "/missing/right.txt",
  updatedAt: 1000,
};

const folderRecentSession: RecentSession = {
  id: "folders\n/missing/left\n/missing/right\nquickHash\nvisible\nall\nnofollow",
  kind: "folders",
  leftRoot: "/missing/left",
  rightRoot: "/missing/right",
  options: DEFAULT_FOLDER_SCAN_OPTIONS,
  updatedAt: 2000,
};

function renderStartPage({
  recentSessions = [compareRecentSession],
  recentSessionFailure = null,
  languageMode = "en",
  themeMode = "system",
}: {
  recentSessions?: RecentSession[];
  recentSessionFailure?: { session: RecentSession; message: string } | null;
  languageMode?: AppLanguage;
  themeMode?: ThemeMode;
} = {}): string {
  return renderToStaticMarkup(
    <StartPage
      busy={false}
      languageMode={languageMode}
      themeMode={themeMode}
      settingsFocusRequest={0}
      recentSessions={recentSessions}
      recentSessionFailure={recentSessionFailure}
      onLanguageModeChange={() => {}}
      onThemeModeChange={() => {}}
      onOpenCompare={() => {}}
      onOpenFolders={() => {}}
      onOpenMerge={() => {}}
      onOpenGitRepository={() => {}}
      onDropCompareFiles={() => {}}
      onDropRejected={() => {}}
      onDemoCompare={() => {}}
      onDemoFolders={() => {}}
      onDemoMerge={() => {}}
      onOpenRecentSession={() => {}}
      onClearRecentSessions={() => {}}
      onRemoveRecentSession={() => {}}
    />,
  );
}

describe("StartPage", () => {
  it("exposes keyboard shortcuts on the primary start actions", () => {
    const markup = renderStartPage();

    expect(markup).toContain("aria-keyshortcuts=\"Control+O Meta+O\"");
    expect(markup).toContain("aria-keyshortcuts=\"Control+Shift+O Meta+Shift+O\"");
    expect(markup).toContain("aria-keyshortcuts=\"Control+Alt+O Meta+Alt+O\"");
    expect(markup).toContain("aria-keyshortcuts=\"Control+Alt+G Meta+Alt+G\"");
    expect(markup).toContain("Open Git Repository");
  });

  it("renders language settings as a two-button segmented control", () => {
    const markup = renderStartPage();

    expect(markup).toContain("aria-label=\"Choose language\"");
    expect(markup).toContain("English");
    expect(markup).toContain("한국어");
    expect(markup).toContain("aria-pressed=\"true\">English");
  });

  it("exposes one labelled and focusable Settings destination", () => {
    const markup = renderStartPage();

    expect(markup.match(/id="home-settings"/g)).toHaveLength(1);
    expect(markup).toContain('aria-labelledby="home-settings-title"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('aria-keyshortcuts="Control+, Meta+,"');
    expect(markup).toMatch(/id="home-settings-title"[^>]*>Settings/);
  });

  it("focuses and scrolls the existing destination without creating another screen", () => {
    const destination = {
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
    };

    expect(focusStartPageSettingsDestination(destination)).toBe(true);
    expect(destination.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(destination.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(focusStartPageSettingsDestination(null)).toBe(false);
  });

  it("renders Korean labels when the saved language is Korean", () => {
    const markup = renderStartPage({ languageMode: "ko", recentSessions: [] });

    expect(markup).toContain("파일 비교");
    expect(markup).toContain("폴더 비교");
    expect(markup).toContain("Git 저장소 열기");
    expect(markup).toContain("최근 세션이 없습니다.");
    expect(markup).toContain("aria-label=\"언어 선택\"");
    expect(markup).toContain("aria-pressed=\"true\">한국어");
  });

  it("integrates the copy-only Git tool setup into the start settings area", () => {
    const markup = renderStartPage();

    expect(markup).toContain("aria-label=\"Git tool setup\"");
    expect(markup).toContain("Copy difftool snippet");
    expect(markup).toContain("Copy mergetool snippet");
  });

  it("shows an action to remove a recent session that failed to reopen", () => {
    const markup = renderStartPage({
      recentSessionFailure: {
        session: compareRecentSession,
        message: "Cannot open the recent session. File not found.",
      },
    });

    expect(markup).toContain("Cannot open the recent session.");
    expect(markup).toContain("Remove");
    expect(markup).toContain("left.txt");
    expect(markup).toContain("right.txt");
  });

  it("does not show stale removal guidance after the failed item is no longer in the list", () => {
    const markup = renderStartPage({
      recentSessions: [folderRecentSession],
      recentSessionFailure: {
        session: compareRecentSession,
        message: "Cannot open the recent session.",
      },
    });

    expect(markup).not.toContain("Remove");
  });
});

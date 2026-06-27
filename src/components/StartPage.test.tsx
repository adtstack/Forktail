import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_FOLDER_SCAN_OPTIONS, type RecentSession, type ThemeMode } from "../core/settings";
import { StartPage } from "./StartPage";

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
  themeMode = "system",
}: {
  recentSessions?: RecentSession[];
  recentSessionFailure?: { session: RecentSession; message: string } | null;
  themeMode?: ThemeMode;
} = {}): string {
  return renderToStaticMarkup(
    <StartPage
      busy={false}
      themeMode={themeMode}
      recentSessions={recentSessions}
      recentSessionFailure={recentSessionFailure}
      onThemeModeChange={() => {}}
      onOpenCompare={() => {}}
      onOpenFolders={() => {}}
      onOpenMerge={() => {}}
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
  });

  it("shows an action to remove a recent session that failed to reopen", () => {
    const markup = renderStartPage({
      recentSessionFailure: {
        session: compareRecentSession,
        message: "최근 세션을 열 수 없습니다. 파일을 찾을 수 없습니다.",
      },
    });

    expect(markup).toContain("최근 세션을 열 수 없습니다.");
    expect(markup).toContain("이 항목 제거");
    expect(markup).toContain("left.txt");
    expect(markup).toContain("right.txt");
  });

  it("does not show stale removal guidance after the failed item is no longer in the list", () => {
    const markup = renderStartPage({
      recentSessions: [folderRecentSession],
      recentSessionFailure: {
        session: compareRecentSession,
        message: "최근 세션을 열 수 없습니다.",
      },
    });

    expect(markup).not.toContain("이 항목 제거");
  });
});

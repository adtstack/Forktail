import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import type { FolderScanResult } from "../core/models";
import { demoFolderScanResult } from "../core/samples";
import { DEFAULT_FOLDER_SCAN_OPTIONS } from "../core/settings";
import { FolderCompareView } from "./FolderCompareView";

function renderFolderView(scanProgress: ComponentProps<typeof FolderCompareView>["scanProgress"]) {
  return renderFolderViewWithOptions(DEFAULT_FOLDER_SCAN_OPTIONS, scanProgress);
}

function renderFolderViewWithOptions(
  options: ComponentProps<typeof FolderCompareView>["options"],
  scanProgress: ComponentProps<typeof FolderCompareView>["scanProgress"],
) {
  return renderFolderViewWithResult(demoFolderScanResult(), options, scanProgress);
}

function renderFolderViewWithResult(
  result: FolderScanResult,
  options: ComponentProps<typeof FolderCompareView>["options"],
  scanProgress: ComponentProps<typeof FolderCompareView>["scanProgress"],
) {
  return renderToStaticMarkup(
    <FolderCompareView
      result={result}
      options={options}
      busy={false}
      scanProgress={scanProgress}
      onBack={() => {}}
      onNewScan={() => {}}
      onRescan={() => {}}
      onCancelScan={() => {}}
      onOpenEntry={() => {}}
      onRevealPath={() => {}}
    />,
  );
}

describe("FolderCompareView", () => {
  it("renders scan option controls with the current option state", () => {
    const defaultMarkup = renderFolderView(null);
    const enabledMarkup = renderFolderViewWithOptions(
      {
        compareMode: "fullHash",
        includeHidden: true,
        respectGitignore: true,
        followSymlinks: true,
      },
      null,
    );

    expect(defaultMarkup).toContain("<option value=\"quickHash\" selected=\"\">빠른 해시</option>");
    expect(defaultMarkup).toContain("숨김 포함");
    expect(defaultMarkup).toContain(".gitignore");
    expect(defaultMarkup).toContain("symlink 추적");
    expect(enabledMarkup).toContain("<option value=\"fullHash\" selected=\"\">전체 해시</option>");
    expect(enabledMarkup.match(/checked=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("labels status filter chips with counts and visibility state", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain("aria-label=\"변경 1개, 표시 중\"");
    expect(markup).toContain("aria-label=\"동일 1개, 숨김\"");
  });

  it("renders copy/sync dry-run summaries without apply controls", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain("동기화 드라이런");
    expect(markup).toContain("실제 파일 변경 없음");
    expect(markup).toContain("왼쪽→오른쪽");
    expect(markup).toContain("오른쪽→왼쪽");
    expect(markup).toContain("복사 2 · 덮어쓰기 1 · 확인 필요 2 · 주의 1");
    expect(markup).not.toContain("동기화 적용");
  });

  it("renders folder tree expand controls for directory rows with visible children", () => {
    const result: FolderScanResult = {
      leftRoot: "/left",
      rightRoot: "/right",
      durationMs: 5,
      stats: {
        different: 1,
        leftOnly: 1,
        rightOnly: 0,
        typeMismatch: 0,
        errors: 0,
        same: 0,
      },
      entries: [
        {
          relativePath: "src",
          leftPath: "/left/src",
          rightPath: "/right/src",
          left: { kind: "directory", size: 0, modifiedMs: 1, hash: null },
          right: { kind: "directory", size: 0, modifiedMs: 1, hash: null },
          status: "leftOnly",
          message: null,
        },
        {
          relativePath: "src/App.tsx",
          leftPath: "/left/src/App.tsx",
          rightPath: "/right/src/App.tsx",
          left: { kind: "file", size: 10, modifiedMs: 1, hash: null },
          right: { kind: "file", size: 11, modifiedMs: 2, hash: null },
          status: "different",
          message: null,
        },
      ],
    };

    const markup = renderFolderViewWithResult(result, DEFAULT_FOLDER_SCAN_OPTIONS, null);

    expect(markup).toContain("aria-expanded=\"true\"");
    expect(markup).toContain("aria-label=\"src 접기\"");
    expect(markup).toContain("src/App.tsx");
  });

  it("warns about portable path conflicts before the table", () => {
    const result: FolderScanResult = {
      leftRoot: "/left",
      rightRoot: "/right",
      durationMs: 5,
      stats: {
        different: 0,
        leftOnly: 1,
        rightOnly: 1,
        typeMismatch: 0,
        errors: 0,
        same: 0,
      },
      entries: [
        {
          relativePath: "Config/Prod.yml",
          leftPath: "/left/Config/Prod.yml",
          rightPath: null,
          left: { kind: "file", size: 10, modifiedMs: 1, hash: null },
          right: null,
          status: "leftOnly",
          message: null,
        },
        {
          relativePath: "config/prod.yml",
          leftPath: null,
          rightPath: "/right/config/prod.yml",
          left: null,
          right: { kind: "file", size: 10, modifiedMs: 1, hash: null },
          status: "rightOnly",
          message: null,
        },
      ],
    };

    const markup = renderFolderViewWithResult(result, DEFAULT_FOLDER_SCAN_OPTIONS, null);

    expect(markup).toContain("포터블 경로 충돌 1개");
    expect(markup).toContain("Config/Prod.yml ↔ config/prod.yml");
  });

  it("renders cancellable scan progress with the scanned roots", () => {
    const markup = renderFolderView({
      jobId: 1,
      active: true,
      leftRoot: "/left/root",
      rightRoot: "/right/root",
      message: "폴더 스캔 중입니다.",
    });

    expect(markup).toContain("스캔 중");
    expect(markup).toContain("작업 #1");
    expect(markup).toContain("<button type=\"button\">스캔 취소</button>");
    expect(markup).toContain("/left/root");
    expect(markup).toContain("/right/root");
  });

  it("keeps cancelled scan guidance without offering another cancel action", () => {
    const markup = renderFolderView({
      jobId: 1,
      active: false,
      leftRoot: "/left/root",
      rightRoot: "/right/root",
      message: "스캔을 취소했습니다. 늦게 도착한 결과는 화면에 반영하지 않습니다.",
    });

    expect(markup).toContain("스캔 취소됨");
    expect(markup).toContain("늦게 도착한 결과는 화면에 반영하지 않습니다.");
    expect(markup).not.toContain("<button type=\"button\">스캔 취소</button>");
  });
});

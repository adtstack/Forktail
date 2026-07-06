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

    expect(defaultMarkup).toContain("<option value=\"quickHash\" selected=\"\">Quick hash</option>");
    expect(defaultMarkup).toContain("Hidden");
    expect(defaultMarkup).toContain(".gitignore");
    expect(defaultMarkup).toContain("Symlinks");
    expect(enabledMarkup).toContain("<option value=\"fullHash\" selected=\"\">Full hash</option>");
    expect(enabledMarkup.match(/checked=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("labels status filter chips with counts and visibility state", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain("aria-label=\"Changed 1, shown\"");
    expect(markup).toContain("aria-label=\"Same 1, hidden\"");
  });

  it("renders copy/sync dry-run summaries without apply controls", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain("Sync dry run");
    expect(markup).toContain("No file changes");
    expect(markup).toContain("L -&gt; R");
    expect(markup).toContain("R -&gt; L");
    expect(markup).toContain("copy 2 · overwrite 1 · review 2 · caution 1");
    expect(markup).not.toContain("Apply sync");
  });

  it("labels row primary actions for two-sided and one-sided file compare", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain("Click or Enter to compare this file row");
    expect(markup).not.toContain("Enter or double-click to reveal the left file");
    expect(markup).not.toContain("Enter or double-click to reveal the right file");
  });

  it("renders one-sided file sizes without a missing-side placeholder", () => {
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
          relativePath: "docs/guide.md",
          leftPath: "/left/docs/guide.md",
          rightPath: null,
          left: { kind: "file", size: 10000, modifiedMs: 1, hash: null },
          right: null,
          status: "leftOnly",
          message: null,
        },
        {
          relativePath: "config/prod.yml",
          leftPath: null,
          rightPath: "/right/config/prod.yml",
          left: null,
          right: { kind: "file", size: 12000, modifiedMs: 2, hash: null },
          status: "rightOnly",
          message: null,
        },
      ],
    };

    const markup = renderFolderViewWithResult(result, DEFAULT_FOLDER_SCAN_OPTIONS, null);

    expect(markup).toContain(">9.8 KB<");
    expect(markup).toContain(">11.7 KB<");
    expect(markup).not.toContain("— / 9.8 KB");
    expect(markup).not.toContain("11.7 KB / —");
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
    expect(markup).toContain("aria-label=\"src collapse\"");
    expect(markup).toContain("Enter or double-click to expand or collapse this folder");
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

    expect(markup).toContain("Portable path conflicts: 1");
    expect(markup).toContain("Config/Prod.yml ↔ config/prod.yml");
  });

  it("renders cancellable scan progress with the scanned roots", () => {
    const markup = renderFolderView({
      jobId: 1,
      active: true,
      leftRoot: "/left/root",
      rightRoot: "/right/root",
      message: "Scanning folders.",
    });

    expect(markup).toContain("Scanning");
    expect(markup).toContain("Job #1");
    expect(markup).toContain("<button type=\"button\">Cancel</button>");
    expect(markup).toContain("/left/root");
    expect(markup).toContain("/right/root");
  });

  it("keeps cancelled scan guidance without offering another cancel action", () => {
    const markup = renderFolderView({
      jobId: 1,
      active: false,
      leftRoot: "/left/root",
      rightRoot: "/right/root",
      message: "Scan cancelled. Late results will not update the screen.",
    });

    expect(markup).toContain("Cancelled");
    expect(markup).toContain("Late results will not update the screen.");
    expect(markup).not.toContain("<button type=\"button\">Cancel</button>");
  });
});

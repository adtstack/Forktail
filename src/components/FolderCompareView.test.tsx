import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import type { FolderScanResult } from "../core/models";
import { demoFolderScanResult } from "../core/samples";
import { DEFAULT_FOLDER_SCAN_OPTIONS } from "../core/settings";
import { folderRowGesturePlan } from "../core/folderView";
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
  languageMode: ComponentProps<typeof FolderCompareView>["languageMode"] = "en",
) {
  return renderToStaticMarkup(
    <FolderCompareView
      result={result}
      options={options}
      busy={false}
      languageMode={languageMode}
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
  it("keeps 100 single clicks selection-only without activating an open/read action", () => {
    const plans = Array.from({ length: 100 }, () => folderRowGesturePlan("singleClick"));

    expect(plans).toHaveLength(100);
    expect(plans.every((plan) => plan.selectOnly)).toBe(true);
    expect(plans.some((plan) => plan.activatePrimaryAction)).toBe(false);
    expect(plans.some((plan) => plan.toggleDetails)).toBe(false);
  });

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

  it("defers copy/sync dry-run planning behind a collapsed disclosure", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain("Sync dry run");
    expect(markup).toContain("No file changes");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).not.toContain("L -&gt; R");
    expect(markup).not.toContain("copy 2 · overwrite 1 · review 2 · caution 1");
    expect(markup).not.toContain("Apply sync");
  });

  it("labels row primary actions for two-sided and one-sided file compare", () => {
    const markup = renderFolderView(null);

    expect(markup).toContain(
      "Double-click or press Enter to open this file comparison in a new window",
    );
    expect(markup).not.toContain("Click or Enter to compare this file row");
    expect(markup).not.toContain("Enter or double-click to reveal the left file");
    expect(markup).not.toContain("Enter or double-click to reveal the right file");
  });

  it("keeps the single-click and activation rules visible in English and Korean", () => {
    const result = demoFolderScanResult();
    const english = renderFolderViewWithResult(
      result,
      DEFAULT_FOLDER_SCAN_OPTIONS,
      null,
      "en",
    );
    const korean = renderFolderViewWithResult(
      result,
      DEFAULT_FOLDER_SCAN_OPTIONS,
      null,
      "ko",
    );

    expect(english).toContain('id="folder-interaction-guide"');
    expect(english).toContain('aria-describedby="folder-interaction-guide folder-selection-status"');
    expect(english).toContain("Single click");
    expect(english).toContain("Select only");
    expect(english).toContain("Double-click");
    expect(english).toContain("Open file in a new window · expand or collapse folder");
    expect(korean).toContain("한 번 클릭");
    expect(korean).toContain("선택만");
    expect(korean).toContain("더블 클릭");
    expect(korean).toContain("파일은 새 창 열기 · 폴더는 펼침/접기");
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
        different: 2,
        leftOnly: 0,
        rightOnly: 0,
        typeMismatch: 0,
        errors: 0,
        same: 1,
      },
      entries: [
        {
          relativePath: "README.md",
          leftPath: "/left/README.md",
          rightPath: "/right/README.md",
          left: { kind: "file", size: 8, modifiedMs: 1, hash: null },
          right: { kind: "file", size: 9, modifiedMs: 2, hash: null },
          status: "different",
          message: null,
        },
        {
          relativePath: "src",
          leftPath: "/left/src",
          rightPath: "/right/src",
          left: { kind: "directory", size: 0, modifiedMs: 1, hash: null },
          right: { kind: "directory", size: 0, modifiedMs: 1, hash: null },
          status: "same",
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
    expect(markup).toContain("folder-context-row");
    expect(markup).toContain("<span class=\"folder-entry-name\">App.tsx</span>");
    expect(markup).toContain("<small class=\"folder-entry-parent\">src/</small>");
    expect(markup.indexOf("aria-label=\"src,")).toBeLessThan(
      markup.indexOf("aria-label=\"README.md,"),
    );
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

  it("renders pending progressive rows as checking with folder context", () => {
    const markup = renderToStaticMarkup(
      <FolderCompareView
        result={{
          leftRoot: "/left",
          rightRoot: "/right",
          durationMs: 0,
          entries: [],
          stats: {
            same: 0,
            different: 0,
            leftOnly: 0,
            rightOnly: 0,
            typeMismatch: 0,
            errors: 0,
          },
        }}
        progressiveRows={[{
          relativePath: "src/App.tsx",
          revision: 1,
          leftPath: "/left/src/App.tsx",
          rightPath: null,
          left: { kind: "file", size: 10, modifiedMs: 1, hash: null },
          right: null,
          resolution: { state: "pending", reason: "awaitingPeer" },
          message: null,
        }]}
        options={DEFAULT_FOLDER_SCAN_OPTIONS}
        busy={false}
        scanProgress={{
          jobId: 3,
          scanGeneration: 2,
          active: true,
          leftRoot: "/left",
          rightRoot: "/right",
          message: "Scanning folders.",
          progress: {
            phase: "inventory",
            discovered: 1,
            finalized: 0,
            pending: 1,
            errors: 0,
            hashedFiles: 0,
            hashCandidates: null,
          },
          terminal: null,
        }}
        onBack={() => {}}
        onNewScan={() => {}}
        onRescan={() => {}}
        onCancelScan={() => {}}
        onOpenEntry={() => {}}
        onRevealPath={() => {}}
      />,
    );

    expect(markup).toContain("Checking");
    expect(markup).toContain("src/App.tsx");
    expect(markup).toContain("folder-context-row");
    expect(markup).not.toContain(
      "Double-click or press Enter to open this file comparison in a new window",
    );
  });

  it("shows known progressive counts without inventing a percentage", () => {
    const markup = renderFolderView({
      jobId: 7,
      scanGeneration: 2,
      active: true,
      leftRoot: "/left",
      rightRoot: "/right",
      message: "Scanning folders.",
      progress: {
        phase: "hash",
        discovered: 12,
        finalized: 5,
        pending: 7,
        errors: 1,
        hashedFiles: 4,
        hashCandidates: 8,
      },
      terminal: null,
    });

    expect(markup).toContain("Discovered 12");
    expect(markup).toContain("Final 5");
    expect(markup).toContain("Checking 7");
    expect(markup).toContain("Errors 1");
    expect(markup).not.toMatch(/\d+%/);
  });
});

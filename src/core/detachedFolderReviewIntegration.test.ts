/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const folderViewSource = readFileSync(
  new URL("../components/FolderCompareView.tsx", import.meta.url),
  "utf8",
);
const nativeCommandSource = readFileSync(
  new URL("../../src-tauri/src/commands/detached_review.rs", import.meta.url),
  "utf8",
);

describe("detached folder review integration", () => {
  it("keeps single-click as selection and reserves activation for double-click or Enter", () => {
    const clickHandler = sourceBetween(
      folderViewSource,
      "const handleRowClick",
      "const handleRowDoubleClick",
    );
    const doubleClickHandler = sourceBetween(
      folderViewSource,
      "const handleRowDoubleClick",
      "const copyPath",
    );
    const keyHandler = sourceBetween(
      folderViewSource,
      "const handleRowKeyDown",
      "const updateMode",
    );

    expect(clickHandler).toContain("selectRow(index)");
    expect(clickHandler).not.toContain("onOpenEntry");
    expect(clickHandler).not.toContain("runPrimaryAction");
    expect(doubleClickHandler).toContain("runPrimaryAction(entry)");
    expect(keyHandler).toMatch(/event\.key === "Enter"[\s\S]*?runPrimaryAction\(entry\)/);
  });

  it("opens a native child without reading content or navigating the source screen", () => {
    const handler = sourceBetween(appSource, "const openFolderEntry", "const revealFolderPath");
    const nativeBranch = handler.slice(handler.indexOf("openDetachedFolderReview"));

    expect(nativeBranch).toContain("detachedFolderReviewOpenRequest");
    expect(nativeBranch).not.toContain("readFolderReviewTextPair");
    expect(nativeBranch).not.toContain("setMode(");
    expect(nativeBranch).not.toContain("setFolderResult(");
  });

  it("invalidates the previous generation without closing ready child snapshots", () => {
    const replacement = sourceBetween(
      appSource,
      "const replaceFolderReviewScope",
      "const setCleanMergeSession",
    );

    expect(replacement).toContain("invalidateDetachedFolderReviewSource");
    expect(replacement).toContain("sourceReviewToken");
    expect(replacement).toContain("scanGeneration");
  });

  it("restores, shows, and focuses an existing child and retries a stale handle", () => {
    const openFlow = sourceBetween(
      nativeCommandSource,
      "async fn open_or_focus",
      "#[tauri::command]\npub fn invalidate_detached_folder_review_source",
    );

    expect(openFlow).toContain("wait_until_window_created");
    expect(openFlow).toContain("registry.destroy(&label)");
    expect(openFlow).toContain("focus_window(&window)");
    expect(nativeCommandSource).toContain("window.unminimize()");
    expect(nativeCommandSource).toContain("window.show()");
    expect(nativeCommandSource).toContain("window.set_focus()");
    expect(openFlow).toContain("registry.rollback_creation(&reservation)");
  });
});

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing source marker: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

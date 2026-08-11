/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DetachedFolderReviewLoaded, FolderReviewTextPairRequest } from "./models";
import {
  buildDetachedFolderReviewSession,
  detachedFolderReviewDisplayTitle,
  detachedFolderReviewModelPath,
  detachedFolderReviewOpenRequest,
  isDetachedFolderReviewSurface,
} from "./detachedFolderReview";

const registrySource = readFileSync(
  new URL("../../src-tauri/src/detached_review.rs", import.meta.url),
  "utf8",
).split("#[cfg(test)]")[0] ?? "";

describe("detached folder review contract", () => {
  it("converts one exact current folder scope without adding file content", () => {
    const pair: FolderReviewTextPairRequest = {
      leftRoot: "/private/left",
      rightRoot: "/private/right",
      relativePath: "src/main.rs",
      leftExpected: "regularFile",
      rightExpected: "missing",
    };

    const request = detachedFolderReviewOpenRequest(
      { reviewToken: "review-7", scanGeneration: 11 },
      pair,
    );

    expect(request).toEqual({
      sourceReviewToken: "review-7",
      scanGeneration: 11,
      ...pair,
    });
    expect(JSON.stringify(request)).not.toMatch(/\b(text|content)\b/i);
  });

  it("builds a strict read-only session with an explicit missing side", () => {
    const loaded = loadedPair();
    const session = buildDetachedFolderReviewSession(loaded);

    expect(session.origin).toBe("folderReview");
    expect(session.left).toBe(loaded.left);
    expect(session.right).toMatchObject({
      name: "main.rs",
      text: "",
      virtual: { kind: "missing" },
    });
  });

  it("keeps title and Monaco model identity relative and path-free", () => {
    const loaded = loadedPair();

    expect(detachedFolderReviewDisplayTitle(loaded.context)).toBe(
      "main.rs — src — forktail",
    );
    const modelPath = detachedFolderReviewModelPath(loaded.modelIdentity, "left", 2);
    expect(modelPath).toBe("forktail://detached/detached-model-42/left/2");
    expect(modelPath).not.toContain("/private/");
    expect(modelPath).not.toContain("review-7");
  });

  it("distinguishes equal basenames by parent and bounds sanitized titles", () => {
    const first = detachedFolderReviewDisplayTitle({
      fileName: "index.ts",
      parentRelativePath: "src/client",
    });
    const second = detachedFolderReviewDisplayTitle({
      fileName: "index.ts",
      parentRelativePath: "src/server",
    });
    const long = detachedFolderReviewDisplayTitle({
      fileName: `unsafe\n${"가".repeat(200)}.ts`,
      parentRelativePath: "nested",
    });

    expect(first).not.toBe(second);
    expect(first).toContain("src/client");
    expect(second).toContain("src/server");
    expect(long).not.toContain("\n");
    expect(Array.from(long)).toHaveLength(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("mounts the child root only for the fixed surface marker", () => {
    expect(isDetachedFolderReviewSurface("?surface=folder-review")).toBe(true);
    expect(isDetachedFolderReviewSurface("?surface=folder-review&path=/private/file")).toBe(false);
    expect(isDetachedFolderReviewSurface("?surface=main")).toBe(false);
  });

  it("keeps the native registry descriptor-only", () => {
    expect(registrySource).not.toContain("FileDocument");
    expect(registrySource).not.toMatch(/\b(text|content|diff_output|monaco_state)\s*:/);
  });
});

function loadedPair(): DetachedFolderReviewLoaded {
  return {
    context: {
      fileName: "main.rs",
      parentRelativePath: "src",
      relativePath: "src/main.rs",
      leftRoot: "/private/left",
      rightRoot: "/private/right",
      leftMissing: false,
      rightMissing: true,
    },
    left: {
      path: "/private/left/src/main.rs",
      name: "main.rs",
      text: "fn main() {}\n",
      encoding: "UTF-8",
      lineEnding: "lf",
      hadFinalNewline: true,
      size: 13,
      modifiedMs: 1,
      isBinary: false,
      decodeHadErrors: false,
    },
    right: null,
    modelIdentity: "detached-model-42",
  };
}

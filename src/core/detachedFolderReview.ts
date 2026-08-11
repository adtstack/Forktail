import type {
  DetachedFolderReviewContext,
  DetachedFolderReviewLoaded,
  FolderReviewCompareSession,
  FolderReviewTextPairRequest,
  OpenDetachedFolderReviewRequest,
} from "./models";
import type { FolderReviewScope } from "./folderView";
import { isSafeFolderRelativePath } from "./folderView";
import { virtualMissingFileDocument } from "./virtualDocument";

const DETACHED_MODEL_IDENTITY = /^detached-model-[1-9][0-9]*$/;

export function detachedFolderReviewOpenRequest(
  scope: FolderReviewScope,
  pair: FolderReviewTextPairRequest,
): OpenDetachedFolderReviewRequest {
  if (
    !scope.reviewToken
    || !Number.isSafeInteger(scope.scanGeneration)
    || scope.scanGeneration <= 0
    || !isSafeFolderRelativePath(pair.relativePath)
    || (pair.leftExpected === "missing" && pair.rightExpected === "missing")
  ) {
    throw new Error("Detached folder review requires one exact current file row.");
  }
  return {
    sourceReviewToken: scope.reviewToken,
    scanGeneration: scope.scanGeneration,
    ...pair,
  };
}

export function buildDetachedFolderReviewSession(
  loaded: DetachedFolderReviewLoaded,
): FolderReviewCompareSession {
  validateLoadedPair(loaded);
  const missingPath = loaded.context.relativePath;
  return {
    origin: "folderReview",
    left: loaded.left ?? virtualMissingFileDocument(missingPath),
    right: loaded.right ?? virtualMissingFileDocument(missingPath),
  };
}

export function detachedFolderReviewDisplayTitle(
  context: Pick<DetachedFolderReviewContext, "fileName" | "parentRelativePath">,
): string {
  const file = sanitizeTitlePart(context.fileName, "file");
  const parent = sanitizeTitlePart(context.parentRelativePath, "root");
  const title = `${file} — ${parent} — forktail`;
  return Array.from(title).length <= 160
    ? title
    : `${Array.from(title).slice(0, 159).join("")}…`;
}

export function detachedFolderReviewModelPath(
  modelIdentity: string,
  side: "left" | "right",
  revision: number,
): string {
  if (!DETACHED_MODEL_IDENTITY.test(modelIdentity)) {
    throw new Error("Detached folder review model identity is invalid.");
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Detached folder review model revision is invalid.");
  }
  return `forktail://detached/${modelIdentity}/${side}/${revision}`;
}

export function isDetachedFolderReviewSurface(search: string): boolean {
  const params = new URLSearchParams(search);
  return Array.from(params.keys()).length === 1
    && params.get("surface") === "folder-review";
}

function validateLoadedPair(loaded: DetachedFolderReviewLoaded): void {
  if (!DETACHED_MODEL_IDENTITY.test(loaded.modelIdentity)) {
    throw new Error("Detached folder review model identity is invalid.");
  }
  if (!isSafeFolderRelativePath(loaded.context.relativePath)) {
    throw new Error("Detached folder review context path is invalid.");
  }
  if (
    (loaded.left === null) !== loaded.context.leftMissing
    || (loaded.right === null) !== loaded.context.rightMissing
    || (loaded.left === null && loaded.right === null)
  ) {
    throw new Error("Detached folder review documents do not match the native context.");
  }
}

function sanitizeTitlePart(value: string, fallback: string): string {
  const sanitized = Array.from(value)
    .filter((character) => !/[\u0000-\u001F\u007F]/u.test(character))
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return sanitized || fallback;
}

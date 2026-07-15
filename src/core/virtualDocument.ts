import type { CompareSession, FileDocument } from "./models";

export function isVirtualFileDocument(
  document: Pick<FileDocument, "virtual">,
): boolean {
  return document.virtual !== undefined;
}

export function isMissingFileDocument(
  document: Pick<FileDocument, "virtual">,
): boolean {
  return document.virtual?.kind === "missing"
    || (
      document.virtual?.kind === "gitSnapshot"
      && document.virtual.contentState === "missing"
    );
}

export function compareSessionHasVirtualDocument(session: CompareSession): boolean {
  return isVirtualFileDocument(session.left) || isVirtualFileDocument(session.right);
}

export function virtualMissingFileDocument(path: string): FileDocument {
  return {
    path,
    name: fileNameFromPath(path),
    text: "",
    encoding: "Missing",
    lineEnding: "none",
    hadFinalNewline: true,
    size: 0,
    modifiedMs: null,
    isBinary: false,
    decodeHadErrors: false,
    virtual: { kind: "missing" },
  };
}

export function folderExpectedPath(root: string, relativePath: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const relative = separator === "\\" ? relativePath.replace(/\//g, "\\") : relativePath;
  const trimmedRoot = root.replace(/[\\/]+$/, "");

  if (trimmedRoot.length > 0) return `${trimmedRoot}${separator}${relative}`;
  if (root.startsWith("/") || root.startsWith("\\")) return `${separator}${relative}`;
  return relative;
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

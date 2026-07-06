import type {
  CompareSession,
  FileDocument,
  FolderEntry,
  FolderScanResult,
  FsEntryMeta,
  MergeSession,
} from "./models";
import { folderExpectedPath, virtualMissingFileDocument } from "./virtualDocument";

export const DEMO_FOLDER_LEFT_ROOT = "/demo/left";
export const DEMO_FOLDER_RIGHT_ROOT = "/demo/right";
export const DEMO_COMPARE_LEFT_PATH = "demo/original.ts";
export const DEMO_COMPARE_RIGHT_PATH = "demo/modified.ts";
export const DEMO_MERGE_BASE_PATH = "demo/base.ts";
export const DEMO_MERGE_OURS_PATH = "demo/ours.ts";
export const DEMO_MERGE_THEIRS_PATH = "demo/theirs.ts";

function document(path: string, text: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs: null,
    isBinary: false,
    decodeHadErrors: false,
  };
}

export function demoCompareSession(): CompareSession {
  const left = `export function calculateTotal(items: Item[]): number {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n`;
  const right = `export function calculateTotal(items: Item[], taxRate = 0): number {\n  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n  return subtotal * (1 + taxRate);\n}\n`;
  const rightWithoutFinalNewline = right.replace(/\n$/, "");
  return {
    left: document(DEMO_COMPARE_LEFT_PATH, left),
    right: document(DEMO_COMPARE_RIGHT_PATH, rightWithoutFinalNewline),
  };
}

export function isDemoComparePaths(leftPath: string, rightPath: string): boolean {
  return leftPath === DEMO_COMPARE_LEFT_PATH && rightPath === DEMO_COMPARE_RIGHT_PATH;
}

export function demoFolderEntryCompareSession(entry: FolderEntry): CompareSession | null {
  if (entry.status === "error" || entry.status === "typeMismatch") return null;

  const hasLeftFile = entry.leftPath != null && entry.left?.kind === "file";
  const hasRightFile = entry.rightPath != null && entry.right?.kind === "file";
  const hasNonFileEntry =
    (entry.left != null && entry.left.kind !== "file") ||
    (entry.right != null && entry.right.kind !== "file");

  if (hasNonFileEntry || (!hasLeftFile && !hasRightFile)) return null;

  if (entry.relativePath === "src/App.tsx") {
    return demoCompareSession();
  }

  const leftPath = hasLeftFile ? entry.leftPath : null;
  const rightPath = hasRightFile ? entry.rightPath : null;

  if (entry.relativePath === "README.md" && leftPath && rightPath) {
    const text = `# forktail\n\nLocal-first text and folder comparison.\n`;
    return {
      left: document(leftPath, text),
      right: document(rightPath, text),
    };
  }

  return {
    left: leftPath
      ? document(leftPath, `left/${entry.relativePath}\n`)
      : virtualMissingFileDocument(folderExpectedPath(DEMO_FOLDER_LEFT_ROOT, entry.relativePath)),
    right: rightPath
      ? document(rightPath, `right/${entry.relativePath}\n`)
      : virtualMissingFileDocument(folderExpectedPath(DEMO_FOLDER_RIGHT_ROOT, entry.relativePath)),
  };
}

export function demoMergeSession(): MergeSession {
  const base = `export function greet(name: string) {\n  return \`Hello, \${name}\`;\n}\n\nexport function signoff() {\n  return "Goodbye";\n}\n`;
  const ours = `export function greet(name: string) {\n  const safeName = name.trim();\n  return \`Hello, \${safeName}\`;\n}\n\nexport function signoff() {\n  return "See you soon";\n}\n`;
  const theirs = `export function greet(name: string, excited = false) {\n  const message = \`Hello, \${name}\`;\n  return excited ? \`\${message}!\` : message;\n}\n\nexport function signoff(name: string) {\n  return \`Goodbye, \${name}\`;\n}\n`;
  const result = `<<<<<<< ours\nexport function greet(name: string) {\n  const safeName = name.trim();\n  return \`Hello, \${safeName}\`;\n}\n||||||| original\nexport function greet(name: string) {\n  return \`Hello, \${name}\`;\n}\n=======\nexport function greet(name: string, excited = false) {\n  const message = \`Hello, \${name}\`;\n  return excited ? \`\${message}!\` : message;\n}\n>>>>>>> theirs\n\n<<<<<<< ours\nexport function signoff() {\n  return "See you soon";\n}\n||||||| original\nexport function signoff() {\n  return "Goodbye";\n}\n=======\nexport function signoff(name: string) {\n  return \`Goodbye, \${name}\`;\n}\n>>>>>>> theirs\n`;

  return {
    base: document(DEMO_MERGE_BASE_PATH, base),
    ours: document(DEMO_MERGE_OURS_PATH, ours),
    theirs: document(DEMO_MERGE_THEIRS_PATH, theirs),
    result,
    outputPath: null,
  };
}

export function isDemoMergePaths(
  basePath: string,
  oursPath: string,
  theirsPath: string,
): boolean {
  return (
    basePath === DEMO_MERGE_BASE_PATH &&
    oursPath === DEMO_MERGE_OURS_PATH &&
    theirsPath === DEMO_MERGE_THEIRS_PATH
  );
}

export function demoFolderScanResult(): FolderScanResult {
  const entries: FolderEntry[] = [
    {
      relativePath: "src/App.tsx",
      leftPath: "/demo/left/src/App.tsx",
      rightPath: "/demo/right/src/App.tsx",
      left: fileMeta(4210, 1782451200000, "left-app"),
      right: fileMeta(4384, 1782454800000, "right-app"),
      status: "different",
      message: null,
    },
    {
      relativePath: "README.md",
      leftPath: "/demo/left/README.md",
      rightPath: "/demo/right/README.md",
      left: fileMeta(3011, 1782447600000, "readme"),
      right: fileMeta(3011, 1782447600000, "readme"),
      status: "same",
      message: null,
    },
    {
      relativePath: "docs",
      leftPath: "/demo/left/docs",
      rightPath: null,
      left: directoryMeta(1782433000000),
      right: null,
      status: "leftOnly",
      message: null,
    },
    {
      relativePath: "docs/guide.md",
      leftPath: "/demo/left/docs/guide.md",
      rightPath: null,
      left: fileMeta(1850, 1782433200000, "guide"),
      right: null,
      status: "leftOnly",
      message: null,
    },
    {
      relativePath: "config",
      leftPath: null,
      rightPath: "/demo/right/config",
      left: null,
      right: directoryMeta(1782461000000),
      status: "rightOnly",
      message: null,
    },
    {
      relativePath: "config/prod.yml",
      leftPath: null,
      rightPath: "/demo/right/config/prod.yml",
      left: null,
      right: fileMeta(944, 1782462000000, "prod"),
      status: "rightOnly",
      message: null,
    },
    {
      relativePath: "assets/logo",
      leftPath: "/demo/left/assets/logo",
      rightPath: "/demo/right/assets/logo",
      left: directoryMeta(1782408000000),
      right: fileMeta(690, 1782408000000, "logo"),
      status: "typeMismatch",
      message: "Left is a folder; right is a file.",
    },
    {
      relativePath: "private/secret.txt",
      leftPath: "/demo/left/private/secret.txt",
      rightPath: "/demo/right/private/secret.txt",
      left: null,
      right: null,
      status: "error",
      message: "Permission denied while reading metadata.",
    },
  ];

  return {
    leftRoot: DEMO_FOLDER_LEFT_ROOT,
    rightRoot: DEMO_FOLDER_RIGHT_ROOT,
    entries,
    stats: {
      different: 1,
      leftOnly: 2,
      rightOnly: 2,
      typeMismatch: 1,
      same: 1,
      errors: 1,
    },
    durationMs: 18,
  };
}

export function isDemoFolderRoots(leftRoot: string, rightRoot: string): boolean {
  return leftRoot === DEMO_FOLDER_LEFT_ROOT && rightRoot === DEMO_FOLDER_RIGHT_ROOT;
}

function fileMeta(size: number, modifiedMs: number, hash: string): FsEntryMeta {
  return { kind: "file", size, modifiedMs, hash };
}

function directoryMeta(modifiedMs: number): FsEntryMeta {
  return { kind: "directory", size: 0, modifiedMs, hash: null };
}

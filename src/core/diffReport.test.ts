import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  buildDiffReport,
  buildGitSnapshotPatch,
  compareReportDefaultPath,
  gitSnapshotPatchDefaultPath,
  saveGitSnapshotPatchAs,
} from "./diffReport";
import type { CompareSession, FileDocument, GitFileCompareSession } from "./models";
import type { GitSnapshotDocument } from "./gitModels";

describe("buildDiffReport", () => {
  it("builds a plain text unified-style report", () => {
    const session = compareSession("one\ntwo\nthree\n", "one\nTWO\nthree\nfour");

    expect(
      buildDiffReport({
        session,
        options: { whitespace: "none", ignoreCase: false, ignoreLineEndings: true },
        generatedAt: new Date("2026-06-26T00:00:00.000Z"),
      }),
    ).toBe(`forktail diff report
Generated: 2026-06-26T00:00:00.000Z
Left: /repo/left.txt
Right: /repo/right.txt
Options: whitespace=none, ignoreCase=false, ignoreEOL=true
Left metadata: UTF-8, LF, final newline yes, 14 bytes
Right metadata: UTF-8, LF, final newline no, 18 bytes

--- /repo/left.txt
+++ /repo/right.txt
@@ -1,3 +1,4 @@
 one
-two
+TWO
 three
+four
\\ No newline at end of file
`);
  });

  it("reports no line changes when current options ignore the differences", () => {
    const session = compareSession("Alpha  \n", "alpha\n");

    expect(
      buildDiffReport({
        session,
        options: { whitespace: "trim", ignoreCase: true, ignoreLineEndings: true },
      }),
    ).toContain("(no line changes under current options)");
  });

  it("normalizes line endings for report hunks while preserving metadata", () => {
    const session = compareSession("a\r\nb\r\n", "a\nc\n");

    const report = buildDiffReport({
      session: {
        ...session,
        left: { ...session.left, lineEnding: "crlf" },
      },
      options: { whitespace: "none", ignoreCase: false, ignoreLineEndings: true },
    });

    expect(report).toContain("Left metadata: UTF-8, CRLF");
    expect(report).toContain("-b\n+c");
  });
});

describe("compareReportDefaultPath", () => {
  it("uses the right file path with a text diff suffix", () => {
    expect(compareReportDefaultPath(compareSession("left\n", "right\n"))).toBe("/repo/right.txt.diff.txt");
  });

  it("does not suggest a Git temporary path for difftool report export", () => {
    const session = compareSession("left\n", "right\n");

    expect(compareReportDefaultPath({ ...session, origin: "difftool" })).toBeUndefined();
  });
});

describe("buildGitSnapshotPatch", () => {
  it("builds an exact modified patch with full revision identities and paths", () => {
    const session = gitCompareSession(
      gitSnapshot("one\ntwo\n", "src/file.txt", "c"),
      gitSnapshot("one\nTWO\n", "src/file.txt", "d"),
    );
    session.left.text = "tampered presentation model\n";

    expect(buildGitSnapshotPatch(session)).toBe(`# Forktail immutable Git snapshot patch
# Left revision: main~1 (sha1:${"a".repeat(40)})
# Right revision: main (sha1:${"b".repeat(40)})
# Left path: src/file.txt
# Right path: src/file.txt
# Output encoding: UTF-8
diff --git a/src/file.txt b/src/file.txt
index ${"c".repeat(40)}..${"d".repeat(40)} 100644
--- a/src/file.txt
+++ b/src/file.txt
@@ -1,2 +1,2 @@
 one
-two
+TWO
`);
  });

  it("builds exact added and deleted patches with standard zero ranges", () => {
    const added = gitCompareSession(
      missingGitSnapshot("src/new.txt"),
      gitSnapshot("new\nline", "src/new.txt", "d"),
    );
    const deleted = gitCompareSession(
      gitSnapshot("old\nline", "src/old.txt", "c"),
      missingGitSnapshot("src/old.txt"),
    );

    expect(buildGitSnapshotPatch(added)).toBe(`# Forktail immutable Git snapshot patch
# Left revision: main~1 (sha1:${"a".repeat(40)})
# Right revision: main (sha1:${"b".repeat(40)})
# Left path: /dev/null
# Right path: src/new.txt
# Output encoding: UTF-8
diff --git a/src/new.txt b/src/new.txt
new file mode 100644
index ${"0".repeat(40)}..${"d".repeat(40)}
--- /dev/null
+++ b/src/new.txt
@@ -0,0 +1,2 @@
+new
+line
\\ No newline at end of file
`);
    expect(buildGitSnapshotPatch(deleted)).toBe(`# Forktail immutable Git snapshot patch
# Left revision: main~1 (sha1:${"a".repeat(40)})
# Right revision: main (sha1:${"b".repeat(40)})
# Left path: src/old.txt
# Right path: /dev/null
# Output encoding: UTF-8
diff --git a/src/old.txt b/src/old.txt
deleted file mode 100644
index ${"c".repeat(40)}..${"0".repeat(40)}
--- a/src/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-old
-line
\\ No newline at end of file
`);
  });

  it("keeps an empty added blob distinct from missing without inventing an empty hunk", () => {
    const patch = buildGitSnapshotPatch(gitCompareSession(
      missingGitSnapshot("src/empty.txt"),
      gitSnapshot("", "src/empty.txt", "d"),
    ));

    expect(patch).toContain("new file mode 100644");
    expect(patch).toContain(`index ${"0".repeat(40)}..${"d".repeat(40)}`);
    expect(patch).not.toContain("--- /dev/null");
    expect(patch).not.toContain("@@");
  });

  it("builds an exact metadata-only rename and warns when UTF-8 export may be lossy", () => {
    const left = gitSnapshot("same\n", "src/old name.txt", "c");
    const right = gitSnapshot("same\n", "src/new name.txt", "c");
    if (left.textMetadata) {
      left.textMetadata = { ...left.textMetadata, encoding: "UTF-16LE BOM", decodeHadErrors: true };
    }
    const session = gitCompareSession(left, right);

    expect(buildGitSnapshotPatch(session)).toBe(`# Forktail immutable Git snapshot patch
# Left revision: main~1 (sha1:${"a".repeat(40)})
# Right revision: main (sha1:${"b".repeat(40)})
# Left path: src/old name.txt
# Right path: src/new name.txt
# Output encoding: UTF-8
# Warning: source encoding left=UTF-16LE BOM (decode errors), right=UTF-8; review replacement characters before applying.
diff --git a/src/old name.txt b/src/new name.txt
similarity index 100%
rename from src/old name.txt
rename to src/new name.txt
`);
  });

  it("suggests a detached filename and leaves cancel/fault paths mutation-free", async () => {
    const session = gitCompareSession(
      gitSnapshot("left\n", "src/private.ts", "c"),
      gitSnapshot("right\n", "src/private.ts", "d"),
    );
    const before = structuredClone(session);
    let inspected = false;
    let wrote = false;

    expect(gitSnapshotPatchDefaultPath(session)).toBe("forktail-private.ts.patch");
    await expect(saveGitSnapshotPatchAs(session, {
      chooseOutputPath: async () => null,
      inspectOutput: async () => {
        inspected = true;
        return null;
      },
      writeOutput: async () => {
        wrote = true;
        throw new Error("must not write after cancel");
      },
    })).resolves.toEqual({ kind: "cancelled" });
    expect(inspected).toBe(false);
    expect(wrote).toBe(false);

    await expect(saveGitSnapshotPatchAs(session, {
      chooseOutputPath: async () => "/exports/change.patch",
      inspectOutput: async () => ({
        path: "/exports/change.patch",
        size: 12,
        modifiedMs: 1_700_000_000_000,
        contentHash: "existing-output-hash",
      }),
      writeOutput: async (request) => {
        expect(request).toMatchObject({
          path: "/exports/change.patch",
          expectedAbsent: false,
          precondition: {
            expectedSize: 12,
            expectedModifiedMs: 1_700_000_000_000,
            expectedContentHash: "existing-output-hash",
          },
        });
        throw new Error("injected output fault");
      },
    })).rejects.toThrow("injected output fault");
    expect(session).toEqual(before);
  });

  it("keeps a 10,000-line disjoint patch export inside its bounded performance baseline", () => {
    const leftText = Array.from({ length: 10_000 }, (_, index) => `left-${index}`).join("\n");
    const rightText = Array.from({ length: 10_000 }, (_, index) => `right-${index}`).join("\n");
    const session = gitCompareSession(
      gitSnapshot(leftText, "src/generated.txt", "c"),
      gitSnapshot(rightText, "src/generated.txt", "d"),
    );
    const started = performance.now();

    const patch = buildGitSnapshotPatch(session);
    const elapsedMs = performance.now() - started;

    expect(patch).toContain("@@ -1,10000 +1,10000 @@");
    expect(patch).toContain("-left-9999\n\\ No newline at end of file");
    expect(patch).toContain("+right-9999\n\\ No newline at end of file");
    expect(elapsedMs).toBeLessThan(500);
  });
});

function compareSession(leftText: string, rightText: string): CompareSession {
  return {
    origin: "files",
    left: document("/repo/left.txt", leftText),
    right: document("/repo/right.txt", rightText),
  };
}

function document(path: string, text: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n") || text.endsWith("\r"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs: 1000,
    isBinary: false,
    decodeHadErrors: false,
  };
}

function gitCompareSession(
  left: GitSnapshotDocument,
  right: GitSnapshotDocument,
): GitFileCompareSession {
  const leftDocument = document(left.label, left.contentState.kind === "text" ? left.contentState.text : "");
  const rightDocument = document(right.label, right.contentState.kind === "text" ? right.contentState.text : "");
  return {
    origin: "git",
    left: {
      ...leftDocument,
      encoding: left.textMetadata?.encoding ?? "Missing",
      hadFinalNewline: left.textMetadata?.hadFinalNewline ?? true,
      virtual: { kind: "gitSnapshot", contentState: left.contentState.kind === "missing" ? "missing" : "text" },
    },
    right: {
      ...rightDocument,
      encoding: right.textMetadata?.encoding ?? "Missing",
      hadFinalNewline: right.textMetadata?.hadFinalNewline ?? true,
      virtual: { kind: "gitSnapshot", contentState: right.contentState.kind === "missing" ? "missing" : "text" },
    },
    snapshot: {
      repositoryId: "repository-session-1",
      left,
      right,
      sourceKind: "revisionPair",
      revisionPair: {
        left: {
          rawLabel: "main~1",
          resolved: { algorithm: "sha1", hex: "a".repeat(40) },
          kind: "symbolic",
          displayName: "main~1",
        },
        right: {
          rawLabel: "main",
          resolved: { algorithm: "sha1", hex: "b".repeat(40) },
          kind: "branch",
          displayName: "main",
        },
      },
      revision: null,
      capabilities: { edit: false, save: false, hunkCopy: false, exportPatch: true },
      generation: 4,
    },
  };
}

function gitSnapshot(text: string, path: string, objectHex: string): GitSnapshotDocument {
  return {
    origin: "committedBlob",
    label: `${path} snapshot`,
    readOnly: true,
    objectId: { algorithm: "sha1", hex: objectHex.repeat(40) },
    path: { opaqueId: `opaque:${path}`, displayPath: path, utf8Path: path },
    mode: "100644",
    textMetadata: {
      encoding: "UTF-8",
      lineEnding: "lf",
      hadFinalNewline: text.endsWith("\n"),
      decodeHadErrors: false,
      size: new TextEncoder().encode(text).byteLength,
    },
    workingTreeVersion: null,
    contentState: { kind: "text", text },
  };
}

function missingGitSnapshot(path: string): GitSnapshotDocument {
  return {
    origin: "missing",
    label: `${path} missing`,
    readOnly: true,
    objectId: null,
    path: { opaqueId: `opaque:${path}`, displayPath: path, utf8Path: path },
    mode: null,
    textMetadata: null,
    workingTreeVersion: null,
    contentState: { kind: "missing" },
  };
}

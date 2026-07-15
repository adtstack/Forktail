import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  GitHeadState,
  GitBlobDocument,
  GitChangedFileList,
  GitObjectId,
  GitPathIdentity,
  GitRefList,
  GitRevision,
  GitRepositorySummary,
  GitTreeList,
} from "./gitModels";

const rustDtoSource = readFileSync(
  new URL("../../src-tauri/src/domain/git.rs", import.meta.url),
  "utf8",
);

describe("Git DTO contract", () => {
  it("keeps object and opaque path field names in camelCase", () => {
    const objectId: GitObjectId = {
      algorithm: "sha256",
      hex: "a".repeat(64),
    };
    const path: GitPathIdentity = {
      opaqueId: "repository-session-1:path-3",
      displayPath: "src\\x80-name.ts",
      utf8Path: null,
    };

    expect(objectId).toEqual({ algorithm: "sha256", hex: "a".repeat(64) });
    expect(path).toEqual({
      opaqueId: "repository-session-1:path-3",
      displayPath: "src\\x80-name.ts",
      utf8Path: null,
    });
  });

  it("keeps repository and head state as a discriminated DTO", () => {
    const head: GitHeadState = {
      kind: "branch",
      fullName: "refs/heads/main",
      displayName: "main",
      objectId: { algorithm: "sha1", hex: "b".repeat(40) },
    };
    const repository: GitRepositorySummary = {
      sessionId: "repository-session-1",
      displayRoot: "/work/example",
      isBare: false,
      isLinkedWorktree: true,
      isShallow: false,
      objectFormat: "sha1",
      head,
    };

    expect(repository).toEqual({
      sessionId: "repository-session-1",
      displayRoot: "/work/example",
      isBare: false,
      isLinkedWorktree: true,
      isShallow: false,
      objectFormat: "sha1",
      head,
    });
  });

  it("keeps resolved revisions pinned to a full immutable object ID", () => {
    const revision: GitRevision = {
      rawLabel: "main~1",
      resolved: { algorithm: "sha1", hex: "c".repeat(40) },
      kind: "symbolic",
      displayName: "main~1",
    };

    expect(revision).toEqual({
      rawLabel: "main~1",
      resolved: { algorithm: "sha1", hex: "c".repeat(40) },
      kind: "symbolic",
      displayName: "main~1",
    });
  });

  it("keeps remote-tracking refs local and annotated tag peel explicit", () => {
    const refs: GitRefList = {
      refs: [
        {
          fullName: "refs/remotes/origin/main",
          displayName: "origin/main",
          kind: "remoteTrackingBranch",
          objectId: { algorithm: "sha1", hex: "d".repeat(40) },
          objectType: "commit",
          peeledObjectId: null,
          peeledObjectType: null,
        },
        {
          fullName: "refs/tags/v2",
          displayName: "v2",
          kind: "tag",
          objectId: { algorithm: "sha1", hex: "e".repeat(40) },
          objectType: "tag",
          peeledObjectId: { algorithm: "sha1", hex: "f".repeat(40) },
          peeledObjectType: "commit",
        },
      ],
      truncated: false,
    };

    expect(refs.refs.map((entry) => entry.kind)).toEqual([
      "remoteTrackingBranch",
      "tag",
    ]);
    expect(refs.refs[1]?.peeledObjectType).toBe("commit");
  });

  it("keeps tree modes typed and paths opaque", () => {
    const tree: GitTreeList = {
      entries: [
        {
          path: {
            opaqueId: "repository-session-1:path:0:1",
            displayPath: "bin/run.sh",
            utf8Path: "bin/run.sh",
          },
          mode: "100755",
          kind: "executableFile",
          objectId: { algorithm: "sha1", hex: "a".repeat(40) },
          objectType: "blob",
          size: 12,
        },
      ],
      truncated: false,
      generation: 0,
    };

    expect(tree.entries[0]?.kind).toBe("executableFile");
    expect(tree.entries[0]?.path.opaqueId).toContain(":path:");
  });

  it("keeps blob text, binary, and too-large states explicit", () => {
    const documents: GitBlobDocument[] = [
      {
        objectId: { algorithm: "sha1", hex: "a".repeat(40) },
        size: 6,
        content: {
          kind: "text",
          text: "hello\n",
          encoding: "UTF-8",
          lineEnding: "lf",
          hadFinalNewline: true,
          decodeHadErrors: false,
        },
      },
      {
        objectId: { algorithm: "sha1", hex: "b".repeat(40) },
        size: 12,
        content: { kind: "binary" },
      },
      {
        objectId: { algorithm: "sha1", hex: "c".repeat(40) },
        size: 64 * 1024 * 1024 + 1,
        content: { kind: "tooLarge" },
      },
      {
        objectId: { algorithm: "sha1", hex: "d".repeat(40) },
        size: 127,
        content: {
          kind: "lfsPointer",
          oidSha256: "e".repeat(64),
          referencedSize: 123456,
        },
      },
    ];

    expect(documents.map((document) => document.content.kind)).toEqual([
      "text",
      "binary",
      "tooLarge",
      "lfsPointer",
    ]);
  });

  it("keeps changed-file status, one-sided paths, scores, counts, and generation explicit", () => {
    const changedFiles: GitChangedFileList = {
      entries: [
        {
          status: "renamed",
          oldPath: {
            opaqueId: "repository-session-1:path:4:1",
            displayPath: "old name.ts",
            utf8Path: "old name.ts",
          },
          newPath: {
            opaqueId: "repository-session-1:path:4:2",
            displayPath: "new name.ts",
            utf8Path: "new name.ts",
          },
          similarityScore: 87,
        },
        {
          status: "added",
          oldPath: null,
          newPath: {
            opaqueId: "repository-session-1:path:4:3",
            displayPath: "added.ts",
            utf8Path: "added.ts",
          },
          similarityScore: null,
        },
      ],
      counts: {
        added: 1,
        deleted: 0,
        modified: 0,
        typeChanged: 0,
        renamed: 1,
        copied: 0,
        unmerged: 0,
        unknown: 0,
        total: 2,
      },
      truncated: false,
      generation: 4,
    };

    expect(changedFiles.entries[0]?.similarityScore).toBe(87);
    expect(changedFiles.entries[1]?.oldPath).toBeNull();
    expect(changedFiles.counts.total).toBe(2);
  });

  it("keeps every head-state variant explicit", () => {
    const states: GitHeadState[] = [
      { kind: "unborn" },
      {
        kind: "detached",
        objectId: { algorithm: "unknown", hex: "ab" },
      },
    ];

    expect(states.map((state) => state.kind)).toEqual(["unborn", "detached"]);
  });

  it("pins the Rust serializer naming contract next to TypeScript", () => {
    expect(rustDtoSource).toContain('#[serde(rename_all = "camelCase")]');
    expect(rustDtoSource).toContain('rename_all_fields = "camelCase"');
    expect(rustDtoSource).toContain("pub struct GitObjectId");
    expect(rustDtoSource).toContain("pub struct GitPathIdentity");
    expect(rustDtoSource).toContain("pub struct GitRevision");
    expect(rustDtoSource).toContain("pub struct GitRepositoryRef");
    expect(rustDtoSource).toContain("pub struct GitRefList");
    expect(rustDtoSource).toContain("pub struct GitTreeEntry");
    expect(rustDtoSource).toContain("pub struct GitTreeList");
    expect(rustDtoSource).toContain("pub enum GitBlobContent");
    expect(rustDtoSource).toContain("pub struct GitBlobDocument");
    expect(rustDtoSource).toContain("pub struct GitRepositorySummary");
  });
});

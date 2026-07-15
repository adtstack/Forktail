import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  GitHeadState,
  GitObjectId,
  GitPathIdentity,
  GitRevision,
  GitRepositorySummary,
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
    expect(rustDtoSource).toContain("pub struct GitRepositorySummary");
  });
});

import { describe, expect, it } from "vitest";
import { CompareDropReplacementCoordinator } from "./compareDropReplacement";
import type { CompareSession, FileDocument } from "./models";

describe("CompareDropReplacementCoordinator", () => {
  it("rejects completion after an edit on the target pane", () => {
    const coordinator = new CompareDropReplacementCoordinator();
    const session = compareSession();
    const request = coordinator.begin("left", 1, session.left);
    const edited = {
      ...session,
      left: document("/repo/left.txt", "typed while reading\n"),
    };

    expect(coordinator.complete(
      request,
      1,
      "compare",
      edited,
      document("/drop/replacement.txt", "replacement\n"),
    )).toEqual({
      kind: "stale",
      reason: "sideChanged",
      session: edited,
    });
  });

  it("applies to the target pane while preserving an edit on the opposite pane", () => {
    const coordinator = new CompareDropReplacementCoordinator();
    const session = compareSession();
    const request = coordinator.begin("left", 1, session.left);
    const editedRight = document("/repo/right.txt", "right edit stays\n");
    const current = { ...session, right: editedRight };
    const replacement = document("/drop/replacement.txt", "replacement\n");

    expect(coordinator.complete(request, 1, "compare", current, replacement)).toEqual({
      kind: "applied",
      session: {
        ...current,
        left: replacement,
        right: editedRight,
      },
    });
  });

  it("rejects completion after the compare session is replaced", () => {
    const coordinator = new CompareDropReplacementCoordinator();
    const session = compareSession();
    const request = coordinator.begin("left", 7, session.left);
    // A lifecycle revision must win even when a replacement happens to reuse
    // the exact same document objects.
    const replacementSession = { ...session };

    expect(coordinator.complete(
      request,
      8,
      "compare",
      replacementSession,
      document("/drop/replacement.txt", "replacement\n"),
    )).toEqual({
      kind: "stale",
      reason: "sessionChanged",
      session: replacementSession,
    });
  });

  it("uses latest-request-wins when two drops finish out of order", () => {
    const coordinator = new CompareDropReplacementCoordinator();
    const session = compareSession();
    const first = coordinator.begin("left", 1, session.left);
    const second = coordinator.begin("left", 1, session.left);
    const latestReplacement = document("/drop/latest.txt", "latest\n");
    const latest = coordinator.complete(second, 1, "compare", session, latestReplacement);
    expect(latest).toEqual({
      kind: "applied",
      session: { ...session, left: latestReplacement },
    });
    if (latest.kind !== "applied") throw new Error("latest drop must apply");

    expect(coordinator.complete(
      first,
      1,
      "compare",
      latest.session,
      document("/drop/older.txt", "older\n"),
    )).toEqual({
      kind: "stale",
      reason: "superseded",
      session: latest.session,
    });
  });

  it("rejects completion after the app leaves the compare lifecycle", () => {
    const coordinator = new CompareDropReplacementCoordinator();
    const session = compareSession();
    const request = coordinator.begin("left", 1, session.left);

    expect(coordinator.complete(
      request,
      1,
      "home",
      session,
      document("/drop/replacement.txt", "replacement\n"),
    )).toEqual({
      kind: "stale",
      reason: "sessionChanged",
      session,
    });
  });
});

function compareSession(root = "/repo"): CompareSession {
  return {
    origin: "files",
    left: document(`${root}/left.txt`, "left\n"),
    right: document(`${root}/right.txt`, "right\n"),
  };
}

function document(path: string, text: string): FileDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    text,
    encoding: "UTF-8",
    lineEnding: "lf",
    hadFinalNewline: text.endsWith("\n"),
    size: new TextEncoder().encode(text).byteLength,
    modifiedMs: 1,
    contentHash: `hash:${path}:${text}`,
    isBinary: false,
    decodeHadErrors: false,
  };
}

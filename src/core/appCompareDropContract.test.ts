/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("App compare drop replacement integration", () => {
  it("binds an async drop to the current pane, session revision, and compare lifecycle", () => {
    expect(appSource).toContain("compareDropReplacementCoordinator.begin(");
    expect(appSource).toContain("compareSessionRevision.current,");
    expect(appSource).toContain("currentSession[side],");
    expect(appSource).toContain("modeRef.current,");
    expect(appSource).toContain("compareSessionRef.current,");
  });

  it("applies the coordinator result without spreading a captured session", () => {
    expect(appSource).toContain("setCompareSession(outcome.session)");
    expect(appSource).not.toContain("setCompareSession({ ...compareSession, left: document })");
    expect(appSource).not.toContain("setCompareSession({ ...compareSession, right: document })");
    expect(appSource).toContain("setError(appText.dropReplacementStale)");
  });

  it("synchronously invalidates an in-flight drop before leaving compare", () => {
    expect(appSource).toContain(
      "const invalidatePendingCompareDrops = useCallback(() => {\n"
        + "    compareSessionRevision.current += 1;",
    );

    const completeBackHome = sourceBetween(
      "const completeBackHome = useCallback",
      "const backHome = useCallback",
    );
    expect(completeBackHome).toContain("invalidatePendingCompareDrops();");
    expect(completeBackHome).toContain('setMode("home")');
    expect(completeBackHome.indexOf("invalidatePendingCompareDrops();"))
      .toBeLessThan(completeBackHome.indexOf('setMode("home")'));

    const completeGitRepositoryLeave = sourceBetween(
      "const completeGitRepositoryLeave = useCallback",
      "const leaveGitRepository = useCallback",
    );
    expect(completeGitRepositoryLeave).toContain("invalidatePendingCompareDrops();");
    expect(completeGitRepositoryLeave).toContain("setGitRepositoryState(null)");
    expect(completeGitRepositoryLeave.indexOf("invalidatePendingCompareDrops();"))
      .toBeLessThan(completeGitRepositoryLeave.indexOf("setGitRepositoryState(null)"));
    expect(completeGitRepositoryLeave.indexOf("invalidatePendingCompareDrops();"))
      .toBeLessThan(completeGitRepositoryLeave.indexOf('setMode("home")'));

    const backFromCompare = sourceBetween(
      "const backFromCompare = () =>",
      "const backFromGitConflict = () =>",
    );
    expect(backFromCompare).toContain("invalidatePendingCompareDrops();");
    expect(backFromCompare).toContain("setCompareSession(null)");
    expect(backFromCompare).toContain("setMode(nextMode)");
    expect(backFromCompare.indexOf("invalidatePendingCompareDrops();"))
      .toBeLessThan(backFromCompare.indexOf("setCompareSession(null)"));
    expect(backFromCompare.indexOf("invalidatePendingCompareDrops();"))
      .toBeLessThan(backFromCompare.indexOf("setMode(nextMode)"));
  });
});

function sourceBetween(start: string, end: string): string {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return appSource.slice(startIndex, endIndex);
}

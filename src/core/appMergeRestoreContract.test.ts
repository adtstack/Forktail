import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("restored merge output safety contract", () => {
  it("inspects a persisted Result path and restores its version or absence baseline", () => {
    expect(appSource).toContain("statOptionalTextFileVersion(session.outputPath)");
    expect(appSource).toContain(
      "mergeOutputBaselineForRestore(session.outputPath, outputVersion)",
    );
    expect(appSource).toContain("outputBaseline.expectedAbsent");
  });

  it("passes the restored absence baseline to the guarded atomic writer", () => {
    expect(appSource).toContain(
      "mergeSession.outputPath === outputPath && mergeOutputExpectedAbsent",
    );
    expect(appSource).toContain("setMergeOutputExpectedAbsent(false)");
  });
});

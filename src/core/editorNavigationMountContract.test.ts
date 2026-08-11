import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fileCompareView = readFileSync(
  new URL("../components/FileCompareView.tsx", import.meta.url),
  "utf8",
);
const mergeView = readFileSync(
  new URL("../components/MergeView.tsx", import.meta.url),
  "utf8",
);

describe("editor navigation Monaco mount contract", () => {
  it("binds compare navigation from the diff editor mount callback", () => {
    expect(fileCompareView).toContain("configureEditorNavigation(instance);");
  });

  it("binds merge Result navigation from the editor mount callback", () => {
    expect(mergeView).toContain("configureResultNavigation(instance);");
  });
});

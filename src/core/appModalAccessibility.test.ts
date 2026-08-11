/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("App modal accessibility integration", () => {
  it("routes every React modal through the shared focus controller", () => {
    expect(appSource.match(/<AccessibleModal\b/g)).toHaveLength(3);
    expect(appSource.match(/data-modal-initial-focus/g)).toHaveLength(3);

    for (const contract of [
      ['labelledBy="unsaved-dialog-title"', 'describedBy="unsaved-dialog-description"',
        "onCancel={cancelPendingLeave}"],
      ['labelledBy="unresolved-save-dialog-title"',
        'describedBy="unresolved-save-dialog-description"', "onCancel={cancelPendingSave}"],
      ['labelledBy="backup-dialog-title"', 'describedBy="backup-dialog-description"',
        "onCancel={() => setBackupDialog(null)}"],
    ]) {
      for (const token of contract) expect(appSource).toContain(token);
    }
  });

  it("blocks capture-phase navigation and native commands while a modal owns interaction", () => {
    expect(appSource.match(/if \(navigationContext\.blockingModal\) return;/g)).toHaveLength(3);
    expect(appSource).toContain(
      "window.addEventListener(APP_COMMAND_EVENT, stopCommand, true)",
    );
    expect(appSource).toContain(
      "window.removeEventListener(APP_COMMAND_EVENT, stopCommand, true)",
    );
    expect(appSource).toContain("stopModalCommandEvent(event)");
  });
});

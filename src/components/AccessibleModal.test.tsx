import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessibleModal } from "./AccessibleModal";

describe("AccessibleModal", () => {
  it("exposes one labelled and described modal dialog with a focus fallback", () => {
    const markup = renderToStaticMarkup(
      <AccessibleModal
        className="backup-dialog"
        labelledBy="dialog-title"
        describedBy="dialog-description"
        onCancel={() => {}}
      >
        <h2 id="dialog-title">Backups</h2>
        <p id="dialog-description">Choose a backup.</p>
        <button type="button" data-modal-initial-focus>Close</button>
      </AccessibleModal>,
    );

    expect(markup).toContain('class="modal-backdrop"');
    expect(markup).toContain('class="confirm-dialog backup-dialog"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="dialog-title"');
    expect(markup).toContain('aria-describedby="dialog-description"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('data-modal-initial-focus="true"');
  });
});

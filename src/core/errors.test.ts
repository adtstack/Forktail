import { describe, expect, it } from "vitest";
import { appErrorCodes, errorMessage, isAppError } from "./errors";

describe("app error contract", () => {
  it("keeps the stable command error code list", () => {
    expect(appErrorCodes).toEqual([
      "CANCELLED",
      "NOT_FOUND",
      "PERMISSION_DENIED",
      "TOO_LARGE",
      "BINARY_FILE",
      "UNSUPPORTED_ENCODING",
      "PATH_CONFLICT",
      "FILE_CHANGED",
      "WRITE_FAILED",
      "SCAN_FAILED",
      "MERGE_FAILED",
    ]);
  });

  it("recognizes serialized command errors", () => {
    expect(isAppError({ code: "NOT_FOUND", message: "File not found." })).toBe(true);
    expect(isAppError({ code: "io", message: "raw os error" })).toBe(false);
    expect(isAppError({ code: "NOT_FOUND" })).toBe(false);
  });

  it("prefers command error messages for display", () => {
    expect(errorMessage({ code: "BINARY_FILE", message: "This is not a text file." })).toBe(
      "This is not a text file.",
    );
  });

  it("uses localized guidance when the default English UI receives a Korean command message", () => {
    expect(errorMessage({ code: "BINARY_FILE", message: "텍스트 파일이 아닙니다." })).toBe(
      "This is not a text file. Binary files are not opened in compare views.",
    );
    expect(errorMessage({ code: "BINARY_FILE", message: "텍스트 파일이 아닙니다." }, "ko")).toBe(
      "텍스트 파일이 아닙니다.",
    );
  });

  it("falls back to code-specific guidance when a command message is empty", () => {
    expect(errorMessage({ code: "TOO_LARGE", message: " " })).toContain("64 MiB");
    expect(errorMessage({ code: "FILE_CHANGED", message: "" })).toContain("Reload");
  });

  it("does not expose raw OS or stack-shaped debug strings to users", () => {
    expect(errorMessage("Os { code: 32, kind: Uncategorized, message: \"busy\" }")).toBe(
      "Could not complete the action. Check paths and permissions, then try again.",
    );
    expect(
      errorMessage({
        message: "thread 'main' panicked at src-tauri/src/lib.rs:10:5",
      }),
    ).toBe("Could not complete the action. Check paths and permissions, then try again.");
  });

  it("keeps deliberate app-level errors actionable", () => {
    expect(errorMessage(new Error("Only demo sessions can be restored automatically in the browser."))).toBe(
      "Only demo sessions can be restored automatically in the browser.",
    );
  });
});

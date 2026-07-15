import { describe, expect, it } from "vitest";
import { appErrorCodes, errorMessage, isAppError } from "./errors";
import { CORE_TEXT } from "./i18n";

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
      "GIT_NOT_FOUND",
      "GIT_VERSION_UNSUPPORTED",
      "GIT_COMMAND_TIMEOUT",
      "GIT_COMMAND_CANCELLED",
      "GIT_OUTPUT_TOO_LARGE",
      "GIT_COMMAND_FAILED",
      "GIT_NOT_REPOSITORY",
      "GIT_UNSAFE_REPOSITORY",
      "GIT_BARE_UNSUPPORTED",
      "GIT_INVALID_REVISION",
      "GIT_AMBIGUOUS_REVISION",
      "GIT_PATH_NOT_AT_REVISION",
      "GIT_OBJECT_MISSING_LOCAL",
      "GIT_OBJECT_TYPE_UNSUPPORTED",
      "GIT_BLOB_TOO_LARGE",
      "GIT_BINARY_BLOB",
      "GIT_LFS_POINTER",
      "GIT_PATH_UNSUPPORTED",
      "GIT_PATH_OUTSIDE_ROOT",
      "GIT_SYMLINK_UNSUPPORTED",
      "GIT_CONFLICT_STATE_CHANGED",
      "GIT_MULTIPLE_MERGE_BASES",
      "GIT_UNRELATED_HISTORIES",
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

  it("uses actionable Git guidance and never displays raw Git process output", () => {
    expect(errorMessage({ code: "GIT_NOT_REPOSITORY", message: "fatal: not a git repository" }))
      .toBe("This folder is not a Git repository. Choose another folder or use regular file compare.");
    expect(errorMessage({ code: "GIT_INVALID_REVISION", message: "fatal: bad revision" }))
      .toContain("branch, tag, commit hash, or HEAD~3");
    expect(errorMessage({ code: "GIT_AMBIGUOUS_REVISION", message: "fatal: ambiguous argument" }))
      .toContain("full ref name or a longer commit hash");
    expect(errorMessage({ code: "GIT_OBJECT_MISSING_LOCAL", message: "fatal: missing blob 123" }))
      .toBe("This snapshot is not available locally. Forktail does not fetch objects automatically.");
    expect(errorMessage({ code: "GIT_BINARY_BLOB", message: "blob bytes" }))
      .toBe("This Git object cannot be opened safely as text. Only its metadata is shown.");
    expect(errorMessage({ code: "GIT_COMMAND_FAILED", message: "stderr: secret/path" }))
      .toBe("Could not complete the Git action. Check the repository state and try again.");
  });

  it("falls back safely for a future unknown Git error code", () => {
    expect(errorMessage({ code: "GIT_FUTURE_FAILURE", message: "fatal: private backend details" }))
      .toBe("Could not complete the action. Check paths and permissions, then try again.");
  });

  it("keeps the conflict-saved next step explicit in both languages", () => {
    expect(CORE_TEXT.en.gitConflictSaved).toBe(
      "Saved the Result file only. Forktail did not run git add or continue.",
    );
    expect(CORE_TEXT.ko.gitConflictSaved).toBe(
      "결과 파일만 저장했습니다. Forktail은 git add나 continue를 실행하지 않았습니다.",
    );
  });

  it("keeps deliberate app-level errors actionable", () => {
    expect(errorMessage(new Error("Only demo sessions can be restored automatically in the browser."))).toBe(
      "Only demo sessions can be restored automatically in the browser.",
    );
  });
});

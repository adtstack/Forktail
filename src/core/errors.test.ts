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
    expect(isAppError({ code: "NOT_FOUND", message: "파일이 없습니다." })).toBe(true);
    expect(isAppError({ code: "io", message: "raw os error" })).toBe(false);
    expect(isAppError({ code: "NOT_FOUND" })).toBe(false);
  });

  it("prefers command error messages for display", () => {
    expect(errorMessage({ code: "BINARY_FILE", message: "텍스트 파일이 아닙니다." })).toBe(
      "텍스트 파일이 아닙니다.",
    );
  });

  it("falls back to code-specific guidance when a command message is empty", () => {
    expect(errorMessage({ code: "TOO_LARGE", message: " " })).toContain("64 MiB 이하");
    expect(errorMessage({ code: "FILE_CHANGED", message: "" })).toContain("다시 읽거나");
  });

  it("does not expose raw OS or stack-shaped debug strings to users", () => {
    expect(errorMessage("Os { code: 32, kind: Uncategorized, message: \"busy\" }")).toBe(
      "작업을 완료하지 못했습니다. 입력 경로와 권한을 확인한 뒤 다시 시도하세요.",
    );
    expect(
      errorMessage({
        message: "thread 'main' panicked at src-tauri/src/lib.rs:10:5",
      }),
    ).toBe("작업을 완료하지 못했습니다. 입력 경로와 권한을 확인한 뒤 다시 시도하세요.");
  });

  it("keeps deliberate app-level errors actionable", () => {
    expect(errorMessage(new Error("브라우저에서는 데모 세션만 자동 복원할 수 있습니다."))).toBe(
      "브라우저에서는 데모 세션만 자동 복원할 수 있습니다.",
    );
  });
});

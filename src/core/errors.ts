import { appErrorCodes, type AppError, type AppErrorCode } from "./models";

export { appErrorCodes };

const appErrorCodeSet = new Set<string>(appErrorCodes);
const fallbackErrorMessage = "작업을 완료하지 못했습니다. 입력 경로와 권한을 확인한 뒤 다시 시도하세요.";
const defaultErrorMessages: Record<AppErrorCode, string> = {
  CANCELLED: "작업을 취소했습니다.",
  NOT_FOUND: "파일 또는 폴더를 찾을 수 없습니다. 경로가 이동됐는지 확인하세요.",
  PERMISSION_DENIED: "권한이 없습니다. 파일 권한을 확인한 뒤 다시 시도하세요.",
  TOO_LARGE: "파일이 너무 큽니다. Phase 1에서는 64 MiB 이하 텍스트 파일만 열 수 있습니다.",
  BINARY_FILE: "텍스트 파일이 아닙니다. 바이너리 파일은 비교 화면에서 열지 않습니다.",
  UNSUPPORTED_ENCODING: "지원하지 않는 인코딩입니다. UTF 계열 텍스트 파일인지 확인하세요.",
  PATH_CONFLICT: "경로를 사용할 수 없습니다. 다른 파일 또는 폴더를 선택하세요.",
  FILE_CHANGED: "파일이 열린 뒤 다른 프로그램에서 변경됐습니다. 다시 읽거나 다른 이름으로 저장하세요.",
  WRITE_FAILED: "파일을 저장하지 못했습니다. 권한과 디스크 상태를 확인한 뒤 다시 시도하세요.",
  SCAN_FAILED: "폴더를 스캔하지 못했습니다. 권한과 경로를 확인한 뒤 다시 시도하세요.",
  MERGE_FAILED: "병합을 완료하지 못했습니다. 입력 파일이 텍스트 파일인지 확인하세요.",
};
const internalDebugMessagePatterns = [
  /\bOs\s*\{/,
  /\bErrorKind::/,
  /\bstd::io::Error\b/,
  /\bthread '.*' panicked\b/,
  /\bat\s+\S+:\d+:\d+/,
  /\bstack backtrace\b/i,
];

export function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" &&
    appErrorCodeSet.has(candidate.code) &&
    typeof candidate.message === "string"
  );
}

export function errorMessage(value: unknown): string {
  if (isAppError(value)) return userMessage(value.message, defaultErrorMessages[value.code]);
  if (value instanceof Error) return userMessage(value.message, fallbackErrorMessage);
  if (typeof value === "string") return userMessage(value, fallbackErrorMessage);
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string") return userMessage(message, fallbackErrorMessage);
  }
  return "알 수 없는 오류가 발생했습니다.";
}

function userMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  if (internalDebugMessagePatterns.some((pattern) => pattern.test(trimmed))) return fallback;
  return trimmed;
}

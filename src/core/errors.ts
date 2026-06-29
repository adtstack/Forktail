import { appErrorCodes, type AppError, type AppErrorCode } from "./models";
import { CORE_TEXT } from "./i18n";
import type { AppLanguage } from "./settings";

export { appErrorCodes };

const appErrorCodeSet = new Set<string>(appErrorCodes);
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

export function errorMessage(value: unknown, language: AppLanguage = "en"): string {
  const text = CORE_TEXT[language].errors;
  if (isAppError(value)) {
    const message = userMessage(value.message, text[value.code]);
    return language === "en" && containsKorean(message) ? text[value.code] : message;
  }
  if (value instanceof Error) return userMessage(value.message, text.fallback);
  if (typeof value === "string") return userMessage(value, text.fallback);
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string") return userMessage(message, text.fallback);
  }
  return text.unknown;
}

function containsKorean(message: string): boolean {
  return /[가-힣]/.test(message);
}

function userMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  if (internalDebugMessagePatterns.some((pattern) => pattern.test(trimmed))) return fallback;
  return trimmed;
}

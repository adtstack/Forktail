import { CORE_TEXT } from "./i18n";
import type { AppLanguage } from "./settings";

export const pathCopyFailureMessage =
  CORE_TEXT.en.pathCopyFailure;

export function pathCopyFailureMessageForLanguage(language: AppLanguage = "en"): string {
  return CORE_TEXT[language].pathCopyFailure;
}

export function pathCopySuccessMessage(label: string, language: AppLanguage = "en"): string {
  return CORE_TEXT[language].pathCopySuccess(label);
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the synchronous fallback for WebViews that deny navigator.clipboard.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy command rejected");
    }
  } finally {
    textarea.remove();
  }
}

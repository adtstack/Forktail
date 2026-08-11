import { APP_COMMAND_EVENT } from "./commands";

const MODAL_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

export function modalTabDestination<T>(
  focusables: readonly T[],
  activeElement: T | null,
  shiftKey: boolean,
): T | null {
  if (focusables.length === 0) return null;
  const activeIndex = activeElement === null ? -1 : focusables.indexOf(activeElement);
  if (activeIndex < 0) return shiftKey ? focusables.at(-1)! : focusables[0]!;
  if (shiftKey && activeIndex === 0) return focusables.at(-1)!;
  if (!shiftKey && activeIndex === focusables.length - 1) return focusables[0]!;
  return null;
}

export function stopModalCommandEvent(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function activateModalFocus(
  container: HTMLElement,
  onCancel: () => void,
): () => void {
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const restoreTarget = focusableElement(ownerDocument.activeElement);
  const focusables = modalFocusableElements(container);
  const initialFocus = focusables.find((element) =>
    element.hasAttribute("data-modal-initial-focus")) ?? focusables[0] ?? container;
  initialFocus.focus({ preventScroll: true });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") {
      const target = event.target;
      if (target && container.contains(target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      initialFocus.focus({ preventScroll: true });
      return;
    }

    const currentFocusables = modalFocusableElements(container);
    if (currentFocusables.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      container.focus({ preventScroll: true });
      return;
    }
    const activeElement = focusableElement(ownerDocument.activeElement);
    const target = modalTabDestination(
      currentFocusables,
      activeElement && container.contains(activeElement) ? activeElement : null,
      event.shiftKey,
    );
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus({ preventScroll: true });
  };

  const stopContainedKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Escape") return;
    // Do not prevent the default action: Enter/Space must still activate buttons
    // inside the modal. Only keep the keydown from reaching background handlers.
    event.stopPropagation();
  };

  const stopBackgroundCommand = (event: Event) => {
    stopModalCommandEvent(event);
  };

  ownerDocument.addEventListener("keydown", handleKeyDown, true);
  container.addEventListener("keydown", stopContainedKeyDown);
  ownerWindow?.addEventListener(APP_COMMAND_EVENT, stopBackgroundCommand, true);
  return () => {
    ownerDocument.removeEventListener("keydown", handleKeyDown, true);
    container.removeEventListener("keydown", stopContainedKeyDown);
    ownerWindow?.removeEventListener(APP_COMMAND_EVENT, stopBackgroundCommand, true);
    if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
  };
}

function modalFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

function focusableElement(value: Element | null): HTMLElement | null {
  if (!value || !("focus" in value)) return null;
  return typeof value.focus === "function" ? value as HTMLElement : null;
}

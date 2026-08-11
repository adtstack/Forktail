import { describe, expect, it, vi } from "vitest";
import {
  APP_COMMAND_EVENT,
  matchesCommandShortcut,
  type AppCommandId,
  type KeyboardShortcutLike,
} from "./commands";
import { activateModalFocus, modalTabDestination } from "./modalFocus";

describe("modalTabDestination", () => {
  const first = { id: "first" };
  const middle = { id: "middle" };
  const last = { id: "last" };
  const focusables = [first, middle, last];

  it("wraps Tab and Shift+Tab only at modal boundaries", () => {
    expect(modalTabDestination(focusables, last, false)).toBe(first);
    expect(modalTabDestination(focusables, first, true)).toBe(last);
    expect(modalTabDestination(focusables, middle, false)).toBeNull();
    expect(modalTabDestination(focusables, middle, true)).toBeNull();
  });

  it("recovers an outside focus target into the modal", () => {
    expect(modalTabDestination(focusables, null, false)).toBe(first);
    expect(modalTabDestination(focusables, { id: "outside" }, true)).toBe(last);
  });
});

describe("activateModalFocus", () => {
  it("focuses the safe action, traps Tab, handles Escape, and restores the trigger", () => {
    const runtime = modalRuntime();
    const onCancel = vi.fn();
    const dispose = activateModalFocus(runtime.container, onCancel);

    expect(runtime.focused()).toBe(runtime.safeAction);

    runtime.setFocused(runtime.dangerAction);
    const forward = runtime.keydown("Tab");
    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(runtime.focused()).toBe(runtime.safeAction);

    const backward = runtime.keydown("Tab", true);
    expect(backward.preventDefault).toHaveBeenCalledOnce();
    expect(runtime.focused()).toBe(runtime.dangerAction);

    const escape = runtime.keydown("Escape");
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(escape.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();

    dispose();
    expect(runtime.focused()).toBe(runtime.trigger);
    expect(runtime.listenerRemoved()).toBe(true);
  });

  it("keeps keyboard and native commands inert until the modal unmounts", () => {
    const runtime = modalRuntime();
    const dispose = activateModalFocus(runtime.container, vi.fn());
    const shortcuts: Array<KeyboardShortcutLike & { commandId: AppCommandId }> = [
      { commandId: "save", key: "s", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
      { commandId: "save", key: "s", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
      {
        commandId: "swapSides",
        key: "x",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      },
      {
        commandId: "acceptOurs",
        key: "1",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      },
      { commandId: "quit", key: "q", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
      {
        commandId: "settings",
        key: ",",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      },
    ];

    for (const shortcut of shortcuts) runtime.keydown(shortcut.key, shortcut);
    runtime.command("acceptTheirs");
    expect(runtime.keyboardCommands()).toEqual([]);
    expect(runtime.nativeCommands()).toEqual([]);

    const activation = runtime.keydown("Enter");
    expect(activation.stopPropagation).toHaveBeenCalledOnce();
    expect(activation.preventDefault).not.toHaveBeenCalled();

    dispose();
    for (const shortcut of shortcuts) runtime.keydown(shortcut.key, shortcut);
    runtime.command("acceptTheirs");
    expect(runtime.keyboardCommands()).toEqual(shortcuts.map(({ commandId }) => commandId));
    expect(runtime.nativeCommands()).toEqual(["acceptTheirs"]);
  });
});

function modalRuntime() {
  type KeyListener = (event: KeyboardEvent) => void;
  type CommandListener = (event: Event) => void;
  let documentKeyListener: KeyListener | null = null;
  let containerKeyListener: KeyListener | null = null;
  let commandCaptureListener: CommandListener | null = null;
  let documentListenerRemoved = false;
  let containerListenerRemoved = false;
  let commandListenerRemoved = false;
  let activeElement: HTMLElement;
  const keyboardCommands: AppCommandId[] = [];
  const nativeCommands: AppCommandId[] = [];

  const trigger = fakeElement("trigger");
  const safeAction = fakeElement("safe", true);
  const dangerAction = fakeElement("danger");
  const container = fakeElement("dialog");
  const focusables = [safeAction, dangerAction];
  const elements = [trigger, safeAction, dangerAction, container];

  const ownerWindow = {
    addEventListener(type: string, listener: CommandListener, capture?: boolean) {
      if (type === APP_COMMAND_EVENT && capture === true) commandCaptureListener = listener;
    },
    removeEventListener(type: string, listener: CommandListener, capture?: boolean) {
      if (
        type === APP_COMMAND_EVENT
        && capture === true
        && commandCaptureListener === listener
      ) {
        commandCaptureListener = null;
        commandListenerRemoved = true;
      }
    },
  } as unknown as Window;

  const ownerDocument = {
    defaultView: ownerWindow,
    get activeElement() {
      return activeElement;
    },
    addEventListener(type: string, listener: KeyListener, capture?: boolean) {
      if (type === "keydown" && capture === true) documentKeyListener = listener;
    },
    removeEventListener(type: string, listener: KeyListener, capture?: boolean) {
      if (type === "keydown" && capture === true && documentKeyListener === listener) {
        documentKeyListener = null;
        documentListenerRemoved = true;
      }
    },
  } as unknown as Document;

  for (const element of elements) {
    element.ownerDocument = ownerDocument;
    element.focus = () => { activeElement = element as unknown as HTMLElement; };
  }
  container.contains = (candidate: Node | null) =>
    candidate === (container as unknown as Node) ||
    focusables.includes(candidate as unknown as FakeElement);
  container.querySelectorAll = () => focusables as unknown as NodeListOf<HTMLElement>;
  container.addEventListener = (type: string, listener: EventListener) => {
    if (type === "keydown") containerKeyListener = listener as KeyListener;
  };
  container.removeEventListener = (type: string, listener: EventListener) => {
    if (type === "keydown" && containerKeyListener === listener as KeyListener) {
      containerKeyListener = null;
      containerListenerRemoved = true;
    }
  };
  activeElement = trigger as unknown as HTMLElement;

  const backgroundKeyDown = (event: KeyboardEvent) => {
    const commandIds: AppCommandId[] = [
      "save",
      "swapSides",
      "acceptOurs",
      "quit",
      "settings",
    ];
    for (const commandId of commandIds) {
      if (matchesCommandShortcut(commandId, event)) keyboardCommands.push(commandId);
    }
  };

  return {
    container: container as unknown as HTMLElement,
    trigger: trigger as unknown as HTMLElement,
    safeAction: safeAction as unknown as HTMLElement,
    dangerAction: dangerAction as unknown as HTMLElement,
    focused: () => activeElement,
    setFocused: (element: HTMLElement) => { activeElement = element; },
    listenerRemoved: () =>
      documentListenerRemoved && containerListenerRemoved && commandListenerRemoved,
    keyboardCommands: () => keyboardCommands,
    nativeCommands: () => nativeCommands,
    keydown(
      key: string,
      options: boolean | Partial<KeyboardShortcutLike> = false,
    ) {
      const shortcut = typeof options === "boolean" ? { shiftKey: options } : options;
      let propagationStopped = false;
      let immediatePropagationStopped = false;
      const event = {
        key,
        shiftKey: shortcut.shiftKey ?? false,
        ctrlKey: shortcut.ctrlKey ?? false,
        metaKey: shortcut.metaKey ?? false,
        altKey: shortcut.altKey ?? false,
        target: activeElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(() => { propagationStopped = true; }),
        stopImmediatePropagation: vi.fn(() => {
          propagationStopped = true;
          immediatePropagationStopped = true;
        }),
      } as unknown as KeyboardEvent;
      documentKeyListener?.(event);
      if (!propagationStopped && !immediatePropagationStopped) containerKeyListener?.(event);
      if (!propagationStopped && !immediatePropagationStopped) backgroundKeyDown(event);
      return event as unknown as {
        preventDefault: ReturnType<typeof vi.fn>;
        stopPropagation: ReturnType<typeof vi.fn>;
        stopImmediatePropagation: ReturnType<typeof vi.fn>;
      };
    },
    command(commandId: AppCommandId) {
      let immediatePropagationStopped = false;
      const event = {
        type: APP_COMMAND_EVENT,
        detail: { commandId, source: "nativeMenu" },
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(() => { immediatePropagationStopped = true; }),
      } as unknown as Event;
      commandCaptureListener?.(event);
      if (!immediatePropagationStopped) nativeCommands.push(commandId);
    },
  };
}

interface FakeElement {
  id: string;
  hidden: boolean;
  isConnected: boolean;
  ownerDocument: Document;
  focus(): void;
  contains(candidate: Node | null): boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  querySelectorAll(): NodeListOf<HTMLElement>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

function fakeElement(id: string, initialFocus = false): FakeElement {
  return {
    id,
    hidden: false,
    isConnected: true,
    ownerDocument: null as unknown as Document,
    focus: () => {},
    contains: () => false,
    hasAttribute: (name) => name === "data-modal-initial-focus" && initialFocus,
    getAttribute: (name) => name === "data-modal-initial-focus" && initialFocus ? "" : null,
    querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

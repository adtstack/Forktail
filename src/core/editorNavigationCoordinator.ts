import {
  EditorNavigationHistory,
  navigationTargetsEqual,
  type NavigationInputSource,
  type NavigationTarget,
  type SemanticNavigationReason,
} from "./editorNavigationHistory";
import type {
  EditorNavigationHandle,
  EditorViewSnapshot,
  MonacoNavigationObservationKind,
} from "./monacoNavigation";

export interface EditorNavigationCoordinatorContext {
  blockingModal: boolean;
  nativeDialogOpen: boolean;
}

export type MountedNavigationOutcome =
  | {
      kind: "restored";
      status: "restored";
      staleDiscarded: number;
      durationMs: number;
    }
  | { kind: "empty"; status: "empty" }
  | { kind: "allStale"; status: "allStale"; staleDiscarded: number }
  | { kind: "blockedModal"; status: "blockedModal" }
  | { kind: "inFlight"; status: "inFlight" }
  | { kind: "failed"; status: "failed" };

interface MountedRegistration {
  handle: EditorNavigationHandle;
  target: NavigationTarget;
}

export interface EditorNavigationCoordinatorOptions {
  history?: EditorNavigationHistory;
  now?: () => number;
}

export class EditorNavigationCoordinator {
  readonly history: EditorNavigationHistory;
  private readonly registrations = new Map<EditorNavigationHandle, MountedRegistration>();
  private readonly now: () => number;

  constructor({
    history = new EditorNavigationHistory(),
    now = defaultNow,
  }: EditorNavigationCoordinatorOptions = {}) {
    this.history = history;
    this.now = now;
  }

  register(handle: EditorNavigationHandle, target: NavigationTarget): () => void {
    const registration = { handle, target };
    this.registrations.set(handle, registration);
    return () => {
      if (this.registrations.get(handle) === registration) this.registrations.delete(handle);
    };
  }

  observe(
    handle: EditorNavigationHandle,
    target: NavigationTarget,
    snapshot: EditorViewSnapshot,
    _kind: MonacoNavigationObservationKind = "cursor",
  ): void {
    const registration = this.registrations.get(handle);
    if (!registration || !navigationTargetsEqual(registration.target, target)) return;
    this.history.observe({
      target,
      pane: snapshot.pane,
      cursor: snapshot.cursor,
      viewport: snapshot.viewport,
    });
  }

  commitCurrent(reason: SemanticNavigationReason): void {
    this.history.commitCurrent(reason);
  }

  availability(context: EditorNavigationCoordinatorContext): boolean {
    if (context.blockingModal || context.nativeDialogOpen) return false;
    return this.history.hasValidCandidate((candidate) =>
      this.findRegistration(candidate.target, candidate.pane) ? "valid" : "stale"
    );
  }

  navigateMountedBack(
    source: NavigationInputSource,
    context: EditorNavigationCoordinatorContext,
  ): MountedNavigationOutcome {
    if (context.blockingModal || context.nativeDialogOpen) {
      return { kind: "blockedModal", status: "blockedModal" };
    }
    const startedAt = this.now();
    let staleDiscarded = 0;

    while (true) {
      const candidate = this.history.reserveNewestValid(source, (location) =>
        this.findRegistration(location.target, location.pane) ? "valid" : "stale"
      );
      if (candidate.kind === "inFlight") return { kind: "inFlight", status: "inFlight" };
      staleDiscarded += candidate.staleDiscarded;
      if (candidate.kind === "empty") {
        return staleDiscarded > 0
          ? { kind: "allStale", status: "allStale", staleDiscarded }
          : { kind: "empty", status: "empty" };
      }
      if (candidate.kind === "blocked") return { kind: "failed", status: "failed" };

      const registration = this.findRegistration(candidate.location.target, candidate.location.pane);
      if (!registration) {
        this.history.discardReservedAsStale(candidate.reservation.invocationId);
        staleDiscarded += 1;
        continue;
      }
      const snapshot: EditorViewSnapshot = {
        pane: candidate.location.pane,
        cursor: candidate.location.cursor,
        viewport: candidate.location.viewport,
      };
      const restored = this.history.withReplay(() => registration.handle.restore(snapshot));
      if (restored.kind === "staleModel") {
        this.history.discardReservedAsStale(candidate.reservation.invocationId);
        staleDiscarded += 1;
        continue;
      }
      if (restored.kind === "unavailable") {
        this.history.releaseReservation(candidate.reservation.invocationId);
        return { kind: "failed", status: "failed" };
      }

      this.history.commitReservation(candidate.reservation.invocationId);
      return {
        kind: "restored",
        status: "restored",
        staleDiscarded,
        durationMs: Math.max(0, this.now() - startedAt),
      };
    }
  }

  isReplaying(): boolean {
    return this.history.isReplaying();
  }

  hasMountedLocation(location: Pick<NavigationLocationLike, "target" | "pane">): boolean {
    return this.findRegistration(location.target, location.pane) != null;
  }

  restoreLocation(
    location: NavigationLocationLike,
  ): "restored" | "stale" | "failed" {
    const registration = this.findRegistration(location.target, location.pane);
    if (!registration) return "stale";
    const restored = this.history.withReplay(() => registration.handle.restore({
      pane: location.pane,
      cursor: location.cursor,
      viewport: location.viewport,
    }));
    if (restored.kind === "staleModel") return "stale";
    if (restored.kind === "unavailable") return "failed";
    return "restored";
  }

  private findRegistration(
    target: NavigationTarget,
    pane: EditorNavigationHandle["pane"],
  ): MountedRegistration | null {
    for (const registration of this.registrations.values()) {
      if (registration.handle.pane === pane && navigationTargetsEqual(registration.target, target)) {
        return registration;
      }
    }
    return null;
  }
}

interface NavigationLocationLike {
  target: NavigationTarget;
  pane: EditorNavigationHandle["pane"];
  cursor: EditorViewSnapshot["cursor"];
  viewport: EditorViewSnapshot["viewport"];
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

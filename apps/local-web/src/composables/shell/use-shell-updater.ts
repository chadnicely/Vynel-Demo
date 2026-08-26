import { onBeforeUnmount, onMounted, ref } from "vue";
import type { Ref } from "vue";

// The shell's update state (gold update flow): the Rust side checks and
// downloads silently, then emits `vynel://update-ready` — this composable
// surfaces the pending version for the restart pill and forwards the restart
// click to `updater_install_now` (the app exits, the installer relaunches the
// new version). Same `withGlobalTauri` seam as use-window-controls: no Tauri
// npm dependency, inert in a plain browser tab.

interface TauriGlobals {
  event: {
    listen(
      name: string,
      handler: (event: { payload: unknown }) => void,
    ): Promise<() => void>;
  };
  core: {
    invoke<T>(command: string): Promise<T>;
  };
  app?: {
    getVersion(): Promise<string>;
  };
}

function findTauri(): TauriGlobals | null {
  return (window as { __TAURI__?: TauriGlobals }).__TAURI__ ?? null;
}

/** What an on-demand check answered — "ready" also flips pendingVersion.
 *  "failed" is transient (offline, a broken download — try again);
 *  "unavailable" is permanent for this build (dev shell, browser tab). */
export type CheckNowOutcome = "ready" | "current" | "failed" | "unavailable";

export interface ShellUpdater {
  /** The shell's own product version; null in a plain browser tab (dev). */
  readonly appVersion: Ref<string | null>;
  /** The downloaded-and-waiting version; null = nothing to offer. */
  readonly pendingVersion: Ref<string | null>;
  /** True after the restart click, while the app tears itself down. */
  readonly installing: Ref<boolean>;
  installNow(): void;
  /** The About dialog's check — asks the shell to check right now instead of
   *  waiting for the four-hour timer. A found update downloads and arms the
   *  pill exactly as a scheduled check would. */
  checkNow(): Promise<CheckNowOutcome>;
}

export function useShellUpdater(): ShellUpdater {
  const appVersion = ref<string | null>(null);
  const pendingVersion = ref<string | null>(null);
  const installing = ref(false);
  const tauri = findTauri();

  if (tauri === null) {
    return {
      appVersion,
      pendingVersion,
      installing,
      installNow: () => {},
      checkNow: () => Promise.resolve("unavailable"),
    };
  }

  let stopReady: (() => void) | null = null;
  onMounted(() => {
    void tauri.app
      ?.getVersion()
      .then((version) => (appVersion.value = version))
      .catch(() => {});
    // The catch-up query first: update-ready may have fired before this
    // webview mounted (or the page reloaded past it).
    void tauri.core
      .invoke<string | null>("updater_pending_version")
      .then((version) => {
        if (version !== null) pendingVersion.value = version;
      })
      .catch(() => {});
    void tauri.event
      .listen("vynel://update-ready", (event) => {
        const payload = event.payload as { version?: string };
        pendingVersion.value = payload.version ?? "new";
      })
      .then((unlisten) => (stopReady = unlisten))
      .catch(() => {});
  });
  onBeforeUnmount(() => stopReady?.());

  return {
    appVersion,
    pendingVersion,
    installing,
    installNow: () => {
      if (installing.value) return;
      installing.value = true;
      // On success the process exits — the catch only fires on failure. The
      // Rust side keeps the downloaded update parked on failure, so dropping
      // back to the ready state re-arms the pill as a retry.
      void tauri.core.invoke("updater_install_now").catch(() => {
        installing.value = false;
      });
    },
    checkNow: async () => {
      // Err from the shell = this build can never check (no updater config);
      // a transient miss comes back as a `failed` answer instead, so the
      // dialog can honestly say "try again" rather than "not in this build".
      try {
        const answer = await tauri.core.invoke<
          | { kind: "ready"; version: string }
          | { kind: "current" }
          | { kind: "failed"; reason: string }
        >("updater_check_now");
        if (answer.kind === "ready") {
          pendingVersion.value = answer.version;
          return "ready";
        }
        return answer.kind;
      } catch {
        return "unavailable";
      }
    },
  };
}

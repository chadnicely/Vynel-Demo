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
}

function findTauri(): TauriGlobals | null {
  return (window as { __TAURI__?: TauriGlobals }).__TAURI__ ?? null;
}

export interface ShellUpdater {
  /** The downloaded-and-waiting version; null = nothing to offer. */
  readonly pendingVersion: Ref<string | null>;
  /** True after the restart click, while the app tears itself down. */
  readonly installing: Ref<boolean>;
  installNow(): void;
}

export function useShellUpdater(): ShellUpdater {
  const pendingVersion = ref<string | null>(null);
  const installing = ref(false);
  const tauri = findTauri();

  if (tauri === null) {
    return { pendingVersion, installing, installNow: () => {} };
  }

  let stopReady: (() => void) | null = null;
  onMounted(() => {
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
  };
}

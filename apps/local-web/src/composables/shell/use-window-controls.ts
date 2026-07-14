import { onBeforeUnmount, onMounted, ref } from "vue";

// Minimize / maximize / close for the frameless main window, via the Tauri
// `withGlobalTauri` global — so the web app takes NO Tauri npm dependency and
// every call degrades to a browser no-op outside the desktop shell (see the
// sibling voice/tauri-overlay-window.ts for the same seam).

interface MainWindowHandle {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
}

interface TauriWindowNamespace {
  getCurrentWindow(): MainWindowHandle;
}

function findTauriWindow(): MainWindowHandle | null {
  const namespace = (window as { __TAURI__?: { window?: TauriWindowNamespace } })
    .__TAURI__?.window;
  return namespace ? namespace.getCurrentWindow() : null;
}

export interface WindowControls {
  /** True inside the Tauri desktop shell (vs a browser tab / dev server). */
  readonly isTauri: boolean;
  /** Whether the window is maximized — drives the restore/maximize glyph. */
  readonly isMaximized: import("vue").Ref<boolean>;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

export function useWindowControls(): WindowControls {
  const handle = findTauriWindow();
  const isMaximized = ref(false);

  if (handle === null) {
    // Browser: window chrome is simulated for looks; the OS controls don't
    // exist to drive, so these are inert (close() is refused by browsers
    // outside script-opened windows).
    return {
      isTauri: false,
      isMaximized,
      minimize: () => {},
      toggleMaximize: () => {
        isMaximized.value = !isMaximized.value;
      },
      close: () => {},
    };
  }

  // A window-control failure (closing window, revoked permission) is never worth
  // surfacing — swallow it so the chrome stays responsive.
  const attempt = (action: Promise<unknown>): void => {
    void action.catch(() => {});
  };

  const syncMaximized = (): void => {
    void handle
      .isMaximized()
      .then((value) => (isMaximized.value = value))
      .catch(() => {});
  };

  let stopResized: (() => void) | null = null;
  onMounted(() => {
    syncMaximized();
    void handle
      .onResized(syncMaximized)
      .then((unlisten) => (stopResized = unlisten))
      .catch(() => {});
  });
  onBeforeUnmount(() => stopResized?.());

  return {
    isTauri: true,
    isMaximized,
    minimize: () => attempt(handle.minimize()),
    toggleMaximize: () => {
      attempt(handle.toggleMaximize());
      syncMaximized();
    },
    close: () => attempt(handle.close()),
  };
}

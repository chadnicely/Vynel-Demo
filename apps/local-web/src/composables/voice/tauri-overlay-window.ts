// Typed access to the Tauri window API for the /jarvis overlay — via the
// `withGlobalTauri` global, so the web app takes NO Tauri npm dependency and
// every call is a no-op outside the desktop shell (Chrome app-window, tabs).

interface TauriWindowHandle {
  show(): Promise<void>;
  hide(): Promise<void>;
  setFocus(): Promise<void>;
  setPosition(position: unknown): Promise<void>;
}

interface TauriWindowNamespace {
  getCurrentWindow(): TauriWindowHandle;
  LogicalPosition: new (x: number, y: number) => unknown;
}

function findTauriWindowNamespace(): TauriWindowNamespace | null {
  const tauriWindow = (window as { __TAURI__?: { window?: TauriWindowNamespace } }).__TAURI__;
  return tauriWindow?.window ?? null;
}

// The overlay's fixed footprint — mirrored from the jarvis window's
// inner_size in apps/desktop/src-tauri/src/windows.rs.
const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 560;

export interface OverlayWindowControls {
  /** True inside the Tauri desktop shell (vs a Chrome app-window / tab). */
  readonly isTauri: boolean;
  /** Bring the overlay on screen (wake). No-op outside Tauri. */
  reveal(): void;
  /** Put the overlay away (session settled). Falls back to window.close(). */
  dismiss(): void;
  /** Park the window centered in the work area — the overlay always appears
   *  mid-screen so it reads as "the assistant is here", never a corner widget. */
  parkCenter(): void;
}

function centeredOverlayPosition(): { x: number; y: number } {
  return {
    x: Math.max(0, Math.round((window.screen.availWidth - OVERLAY_WIDTH) / 2)),
    y: Math.max(0, Math.round((window.screen.availHeight - OVERLAY_HEIGHT) / 2)),
  };
}

export function createOverlayWindowControls(): OverlayWindowControls {
  const tauri = findTauriWindowNamespace();
  if (tauri === null) {
    return {
      isTauri: false,
      reveal: () => {},
      dismiss: () => {
        // Chrome allows this only while the app-window's history has a single
        // entry; when refused the window just stays idle for the next wake.
        window.close();
      },
      parkCenter: () => {
        // Chrome ignores --window-size when already running; app windows may
        // size themselves and remember it.
        window.resizeTo(OVERLAY_WIDTH, OVERLAY_HEIGHT);
        const { x, y } = centeredOverlayPosition();
        window.moveTo(x, y);
      },
    };
  }

  const handle = tauri.getCurrentWindow();
  // Window-API failures (revoked permission, closing window) only ever cost
  // the reveal/park nicety — never the voice session driving them.
  const attempt = (action: Promise<void>): void => {
    void action.catch(() => {});
  };
  return {
    isTauri: true,
    reveal: () => {
      attempt(handle.show());
      attempt(handle.setFocus());
    },
    dismiss: () => attempt(handle.hide()),
    parkCenter: () => {
      const { x, y } = centeredOverlayPosition();
      attempt(handle.setPosition(new tauri.LogicalPosition(x, y)));
    },
  };
}

// Typed access to the Tauri window API for the floating overlays (/jarvis, the
// desktop-control overlay) — via the `withGlobalTauri` global, so the web app
// takes NO Tauri npm dependency and every call is a no-op outside the desktop
// shell (Chrome app-window, tabs).

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

export interface OverlayWindowOptions {
  /** The window's fixed footprint — mirror the inner_size in
   *  apps/desktop/src-tauri/src/windows.rs. Default: the jarvis 420×560. */
  width?: number;
  height?: number;
  /** Where park() puts the window. 'center' reads as "the assistant is here"
   *  (jarvis); 'bottom-right' reads as a corner status widget (the
   *  desktop-control overlay, the ApprovalNotifier position). */
  park?: "center" | "bottom-right";
  /** Whether reveal() also takes keyboard focus. The desktop-control overlay
   *  must NOT (the user may be typing in the app Claude is reading). */
  focusOnReveal?: boolean;
}

const DEFAULT_OPTIONS = {
  width: 420,
  height: 560,
  park: "center" as const,
  focusOnReveal: true,
};

const CORNER_MARGIN = 16;

/** Pure position math, exported for tests. */
export function overlayPosition(
  park: "center" | "bottom-right",
  size: { width: number; height: number },
  available: { width: number; height: number },
): { x: number; y: number } {
  if (park === "bottom-right") {
    return {
      x: Math.max(0, available.width - size.width - CORNER_MARGIN),
      y: Math.max(0, available.height - size.height - CORNER_MARGIN),
    };
  }
  return {
    x: Math.max(0, Math.round((available.width - size.width) / 2)),
    y: Math.max(0, Math.round((available.height - size.height) / 2)),
  };
}

export interface OverlayWindowControls {
  /** True inside the Tauri desktop shell (vs a Chrome app-window / tab). */
  readonly isTauri: boolean;
  /** Bring the overlay on screen (wake). No-op outside Tauri. */
  reveal(): void;
  /** Put the overlay away (session settled). Falls back to window.close(). */
  dismiss(): void;
  /** Park the window at its configured spot (center / bottom-right). */
  park(): void;
  /** Back-compat alias for the jarvis call sites — parks at the configured spot. */
  parkCenter(): void;
}

export function createOverlayWindowControls(
  options: OverlayWindowOptions = {},
): OverlayWindowControls {
  const { width, height, park, focusOnReveal } = { ...DEFAULT_OPTIONS, ...options };
  const position = () =>
    overlayPosition(
      park,
      { width, height },
      { width: window.screen.availWidth, height: window.screen.availHeight },
    );

  const tauri = findTauriWindowNamespace();
  if (tauri === null) {
    const parkWindow = () => {
      // Chrome ignores --window-size when already running; app windows may
      // size themselves and remember it.
      window.resizeTo(width, height);
      const { x, y } = position();
      window.moveTo(x, y);
    };
    return {
      isTauri: false,
      reveal: () => {},
      dismiss: () => {
        // Chrome allows this only while the app-window's history has a single
        // entry; when refused the window just stays idle for the next wake.
        window.close();
      },
      park: parkWindow,
      parkCenter: parkWindow,
    };
  }

  const handle = tauri.getCurrentWindow();
  // Window-API failures (revoked permission, closing window) only ever cost
  // the reveal/park nicety — never the session driving them.
  const attempt = (action: Promise<void>): void => {
    void action.catch(() => {});
  };
  const parkWindow = () => {
    const { x, y } = position();
    attempt(handle.setPosition(new tauri.LogicalPosition(x, y)));
  };
  return {
    isTauri: true,
    reveal: () => {
      attempt(handle.show());
      if (focusOnReveal) attempt(handle.setFocus());
    },
    dismiss: () => attempt(handle.hide()),
    park: parkWindow,
    parkCenter: parkWindow,
  };
}

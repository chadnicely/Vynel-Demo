// Typed access to the Tauri window API for the floating windows (/display-dock, the
// desktop-control overlay) — via the `withGlobalTauri` global, so the web app
// takes NO Tauri npm dependency and every call is a no-op outside the desktop
// shell (Chrome app-window, tabs).

interface TauriWindowHandle {
  show(): Promise<void>;
  hide(): Promise<void>;
  setFocus(): Promise<void>;
  setPosition(position: unknown): Promise<void>;
  setSize(size: unknown): Promise<void>;
}

interface TauriWindowNamespace {
  getCurrentWindow(): TauriWindowHandle;
  LogicalPosition: new (x: number, y: number) => unknown;
  LogicalSize: new (width: number, height: number) => unknown;
}

function findTauriWindowNamespace(): TauriWindowNamespace | null {
  const tauriWindow = (window as { __TAURI__?: { window?: TauriWindowNamespace } }).__TAURI__;
  return tauriWindow?.window ?? null;
}

/** Whether we're running inside the Tauri desktop shell (vs a browser tab).
 *  Read-only and side-effect-free — for callers that need the fact alone,
 *  without constructing a controls object they never drive. */
export function isTauriShell(): boolean {
  return findTauriWindowNamespace() !== null;
}

/** Where a floating window sits. 'center' reads as "the assistant is here"
 *  (the dock on wake); 'bottom-right' reads as a corner status widget (the
 *  desktop-control overlay, the mini dock, the ApprovalNotifier position). */
export type OverlayPark = "center" | "bottom-right";

/** A window's whole footprint: how big, and where. The dock changes ITS one
 *  between modes (wake in the middle, mini in the corner), so size and spot
 *  travel together — computing a corner from a size the window no longer has
 *  is how an overlay ends up half off the screen. */
export interface OverlayLayout {
  readonly park: OverlayPark;
  readonly width: number;
  readonly height: number;
  /** Sit above ANOTHER bottom-right window of this height (plus the corner
   *  gap) so the two stack instead of covering each other — the mini dock over
   *  the desktop-control overlay. Meaningless in the middle of the screen, and
   *  ignored for `park: 'center'`. */
  readonly stackAbove?: { heightPx: number } | undefined;
}

/** The desktop-control attention overlay's footprint, mirrored from
 *  `apps/desktop/src-tauri/src/windows.rs`. Read by that window itself AND by
 *  the mini dock, which stacks above it — a second copy would move one window
 *  and leave the other overlapping it. */
export const DESKTOP_CONTROL_OVERLAY_SIZE = { width: 380, height: 360 } as const;

export interface OverlayWindowOptions {
  /** The window's footprint — mirror the inner_size in
   *  apps/desktop/src-tauri/src/windows.rs. Default: the dock's 420×560. */
  width?: number;
  height?: number;
  /** Where `park()` puts the window. */
  park?: OverlayPark;
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
  layout: OverlayLayout,
  available: { width: number; height: number },
): { x: number; y: number } {
  if (layout.park === "bottom-right") {
    const stacked =
      layout.stackAbove === undefined ? 0 : layout.stackAbove.heightPx + CORNER_MARGIN;
    return {
      x: Math.max(0, available.width - layout.width - CORNER_MARGIN),
      y: Math.max(0, available.height - layout.height - CORNER_MARGIN - stacked),
    };
  }
  return {
    x: Math.max(0, Math.round((available.width - layout.width) / 2)),
    y: Math.max(0, Math.round((available.height - layout.height) / 2)),
  };
}

export interface OverlayWindowControls {
  /** True inside the Tauri desktop shell (vs a Chrome app-window / tab). */
  readonly isTauri: boolean;
  /** Bring the overlay on screen (wake). No-op outside Tauri. `focus`
   *  overrides `focusOnReveal` for this one reveal — a window whose SHAPE
   *  decides the answer: the dock takes the keyboard for a wake conversation
   *  in the middle of the screen, and must never take it for its corner row,
   *  where the user is typing in whatever it floats over. */
  reveal(options?: { focus?: boolean }): void;
  /** Put the overlay away for good — the conversation it carried is over.
   *  Falls back to window.close() outside Tauri. */
  dismiss(): void;
  /** Step aside while the conversation CONTINUES elsewhere (the app's Display
   *  took the room). Deliberately not `dismiss()`: the Chrome fallback closes
   *  the window, which would take the live session with it — so there this
   *  does nothing and the window simply stays put. */
  hide(): void;
  /** Park the window at its configured size + spot. */
  park(): void;
  /** Resize and park in one act — for a window whose footprint changes with
   *  its mode (the dock: 420×560 in the middle on wake, mini in the corner). */
  applyLayout(layout: OverlayLayout): void;
}

export function createOverlayWindowControls(
  options: OverlayWindowOptions = {},
): OverlayWindowControls {
  const { width, height, park, focusOnReveal } = { ...DEFAULT_OPTIONS, ...options };
  const configuredLayout: OverlayLayout = { park, width, height };
  const positionFor = (layout: OverlayLayout) =>
    overlayPosition(layout, {
      width: window.screen.availWidth,
      height: window.screen.availHeight,
    });

  const tauri = findTauriWindowNamespace();
  if (tauri === null) {
    const applyLayout = (layout: OverlayLayout) => {
      // Chrome ignores --window-size when already running; app windows may
      // size themselves and remember it.
      window.resizeTo(layout.width, layout.height);
      const { x, y } = positionFor(layout);
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
      hide: () => {},
      park: () => applyLayout(configuredLayout),
      applyLayout,
    };
  }

  const handle = tauri.getCurrentWindow();
  // Window-API failures (revoked permission, closing window) only ever cost
  // the reveal/park nicety — never the session driving them.
  const attempt = (action: Promise<void>): void => {
    void action.catch(() => {});
  };
  // Size first: the corner spot is computed FROM the new size, so growing the
  // window afterwards would push it past the screen edge it was pinned to.
  const applyLayout = (layout: OverlayLayout) => {
    attempt(handle.setSize(new tauri.LogicalSize(layout.width, layout.height)));
    const { x, y } = positionFor(layout);
    attempt(handle.setPosition(new tauri.LogicalPosition(x, y)));
  };
  return {
    isTauri: true,
    reveal: (options) => {
      attempt(handle.show());
      if (options?.focus ?? focusOnReveal) attempt(handle.setFocus());
    },
    dismiss: () => attempt(handle.hide()),
    hide: () => attempt(handle.hide()),
    park: () => applyLayout(configuredLayout),
    applyLayout,
  };
}

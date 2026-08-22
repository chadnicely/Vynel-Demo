// Every top-level window as an ADDRESSABLE TARGET — the one home for "which
// window did the caller mean?".
//
// WHY this exists: an app name is not a target. Measured 2026-08-22 on Kafi's
// desktop — Chrome ran THREE windows on one pid, Explorer three, the terminal
// five. Every window-directed operation in this package addressed them through
// `Get-Process(pid).MainWindowHandle`: ONE handle per process, which cannot
// name the second Chrome window at all, reports 0 for a tray app, and collapses
// every packaged (UWP) app onto the shared `ApplicationFrameHost`.
//
// `node-screenshots` exposes the real HWND as `Window.id()`. Verified against
// libnut's handle table: all 23 windows matched by id AND title, and the
// focused window's id equalled `libnut.getActiveWindow()`. That retires the
// "needs a real HWND, which the capture binding doesn't expose" limit recorded
// in `window-state.ts`.
//
// Targeting therefore comes from the SAME source as identity
// (`window-identity.ts` already reads `Window.all()`), so there is no
// cross-source join to drift — precisely the failure class `resolveAppIdentity`
// exists to warn about. Full measurements: `docs/desktop-control-window-focus.md`.

import { loadNodeScreenshots } from "./screenshot-adapter.js";
import { readWindowIdentity } from "./window-host-processes.js";
import { isAppNameMatch } from "./app-name-match.js";

export interface DesktopWindow {
  /** The real Win32 HWND (`node-screenshots` `Window.id()`). */
  handle: number;
  pid: number;
  /** Canonical app identity — a UWP window takes its title, and a host process
   *  name is never itself an identity (`window-host-processes.ts`). */
  appName: string;
  title: string;
  minimized: boolean;
  maximized: boolean;
  /** Stacking order — HIGHER is nearer the front (verified empirically against
   *  node-screenshots 0.2.8: the foreground-most window carries the largest z). */
  z: number;
}

/**
 * Every nameable top-level window, newest-front first.
 *
 * An unnameable window is DROPPED rather than given a placeholder: it cannot be
 * authorized against (`assertDesktopAccess` refuses ''), so offering it as a
 * target would only produce a refusal the caller cannot act on.
 */
export function listDesktopWindows(): DesktopWindow[] {
  const { Window } = loadNodeScreenshots();
  const windows: DesktopWindow[] = [];
  for (const native of Window.all()) {
    try {
      const appName = readWindowIdentity(native);
      if (appName === null) continue;
      windows.push({
        handle: Number(native.id()),
        pid: Number(native.pid()),
        appName,
        title: String(native.title() ?? ""),
        minimized: Boolean(native.isMinimized()),
        maximized: Boolean(native.isMaximized()),
        z: Number(native.z()),
      });
    } catch {
      // A shape surprise on one window must not blind the whole roster — the
      // same posture every other reader in this folder takes.
    }
  }
  return windows.sort(compareWindowPreference);
}

/**
 * The ranking behind "the proper window": most-recently-in-front first.
 *
 * NOT "first enumerated" — that is the bug `selectWindowedPid` already had to
 * learn for Electron helper windows, and it is why a Discord snapshot once
 * landed on a stub window.
 *
 * 1. A window that is ON SCREEN beats a minimized one. The caller asked for a
 *    window to look at or act on; one the user already has up is the better
 *    guess, and raising a minimized window is the more disruptive act.
 * 2. Higher `z` — the window most recently in front.
 * 3. Longer title — the app's real window carries the rich dynamic title
 *    ("@user - Discord"); stub and helper windows carry short or empty ones.
 * 4. Lower handle, so the order is deterministic and testable.
 *
 * Pure, so the rule is testable without a desktop.
 */
export function compareWindowPreference(
  a: DesktopWindow,
  b: DesktopWindow,
): number {
  if (a.minimized !== b.minimized) return a.minimized ? 1 : -1;
  if (a.z !== b.z) return b.z - a.z;
  if (a.title.length !== b.title.length) return b.title.length - a.title.length;
  return a.handle - b.handle;
}

export interface WindowMatch {
  window: DesktopWindow;
  /** The other windows that also matched — what makes a wrong pick RECOVERABLE.
   *  The caller reports these so the model can retry naming one by title. */
  alternatives: DesktopWindow[];
}

/**
 * Pick the window a caller meant.
 *
 * `appQuery` matches the app identity, `titleHint` (optional) narrows to one of
 * its windows. App-name matches BEAT title-only matches, so a Chrome window
 * whose page title happens to contain "discord" never outranks Discord itself —
 * the same two-tier rule `selectWindowedPid` learned.
 *
 * Returns null when nothing matches. Never guesses silently: the chosen window
 * and every alternative come back together, and callers name the chosen window
 * in their response.
 *
 * Pure (no I/O) so the whole rule is unit-testable.
 */
export function selectWindow(
  windows: readonly DesktopWindow[],
  appQuery: string,
  titleHint?: string,
): WindowMatch | null {
  const query = appQuery.trim();
  if (query.length === 0) return null;

  const byAppName = windows.filter((window) =>
    isAppNameMatch(window.appName, query),
  );
  const pool =
    byAppName.length > 0
      ? byAppName
      : windows.filter((window) => isAppNameMatch(window.title, query));
  if (pool.length === 0) return null;

  const hint = titleHint?.trim() ?? "";
  const narrowed =
    hint.length > 0
      ? pool.filter((window) => isAppNameMatch(window.title, hint))
      : pool;
  // A hint that matches nothing is a MISS, not a reason to fall back to the
  // whole pool — silently ignoring it would act on a window the caller
  // explicitly did not ask for.
  if (narrowed.length === 0) return null;

  const ranked = [...narrowed].sort(compareWindowPreference);
  const [best, ...alternatives] = ranked;
  if (best === undefined) return null;
  return { window: best, alternatives };
}

/** The frontmost window owned by a pid — how a pid-addressed caller (the
 *  Electron wake) reaches a real HWND. Null when the pid owns no window. */
export function topWindowForPid(
  windows: readonly DesktopWindow[],
  pid: number,
): DesktopWindow | null {
  const owned = windows.filter((window) => window.pid === pid);
  return [...owned].sort(compareWindowPreference)[0] ?? null;
}

/** The window that currently holds the foreground, or null. The focus check
 *  that replaced a ~250 ms PowerShell `GetForegroundWindow` spawn with a ~2 ms
 *  in-process read. */
export function findForegroundWindow(): DesktopWindow | null {
  const { Window } = loadNodeScreenshots();
  for (const native of Window.all()) {
    try {
      if (!native.isFocused()) continue;
      return {
        handle: Number(native.id()),
        pid: Number(native.pid()),
        appName: readWindowIdentity(native) ?? "",
        title: String(native.title() ?? ""),
        minimized: Boolean(native.isMinimized()),
        maximized: Boolean(native.isMaximized()),
        z: Number(native.z()),
      };
    } catch {
      // See listDesktopWindows.
    }
  }
  return null;
}

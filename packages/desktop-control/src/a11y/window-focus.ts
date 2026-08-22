// Bringing a window to the FRONT — verifiably, and with the smallest side
// effect that works.
//
// Windows refuses `SetForegroundWindow` from a background process while
// focus-stealing prevention is armed. Measured 2026-08-22 against a fixture
// that arms the lock deliberately (`LockSetForegroundWindow`), 30 trials across
// a native app, an Electron app and a multi-window browser — the full table
// lives in `docs/desktop-control-window-focus.md`:
//
//   * bare `SetForegroundWindow` .................. 0/9   refused
//   * `AttachThreadInput` + `BringWindowToTop` .... 0/9   refused
//   * `SwitchToThisWindow` ........................ 0/3   refused
//   * `AppActivate(pid)` .......................... 0/9   refused — AND REPORTS TRUE
//   * minimize→restore cycle ...................... 0/3   refused — AND REPORTS TRUE
//   * inject a keystroke, THEN SetForegroundWindow  9/9   works
//
// So there is exactly ONE mechanism: the process must have injected input
// itself, which satisfies the documented "received the last input event"
// exemption. That is why a window operation reaches into the INPUT engine here
// — it is not a layering slip, it is the only thing Windows accepts.
//
// Two consequences the shape of this file encodes:
//
//  1. **The keystroke and the focus call must be the SAME PROCESS.** The input
//     credit belongs to whoever injected. Tapping a key in one process and
//     calling SetForegroundWindow from another does not work — which also rules
//     out `focusWindow()` on its own, since it is bare SetForegroundWindow.
//  2. **A settle between them is load-bearing.** Back-to-back (~2 ms) it failed
//     0/9; with 40-150 ms it passed 6/6. The old PowerShell got this gap for
//     free from `SendKeys`' own ~11 ms COM latency; in-process there is no such
//     accident, so the pause is explicit.
//
// SHIFT, not Alt. Alt defeats the lock equally well and is what we shipped, but
// it arms the focused app's menu bar until its next keypress. Shift is narrower
// — though not free: it is a live modifier that extends selections, so we never
// inject it when the window is ALREADY in front.
//
// Every operation is best-effort: a failure degrades to "not focused" (an
// honest, actionable false), never a thrown turn failure. Focus is OBSERVABLE —
// we verify against the real foreground and never trust a boolean, because two
// of the refusing techniques above return `True`.

import { loadNutInput } from "../input/nut-input-loader.js";
import {
  findForegroundWindow,
  listDesktopWindows,
  topWindowForPid,
} from "./desktop-windows.js";

/** The explicit pause between the keystroke and the focus call. 80 ms sits in
 *  the middle of the measured working band (40-150 ms) — see the header. */
export const FOCUS_SETTLE_MS = 80;
/** How long to wait for the compositor to actually make the window foreground
 *  before calling it a failure. Focus is not instant; the verify must poll. */
export const FOCUS_VERIFY_TIMEOUT_MS = 700;
const FOCUS_VERIFY_INTERVAL_MS = 50;

const realDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The OS seams focus depends on — injectable so every branch is testable
 *  without a desktop, a native binary, or a real clock. */
export type FocusDeps = {
  /** libnut: `ShowWindow(SW_RESTORE)` when iconic, then `SetForegroundWindow`.
   *  Its boolean is not trusted. */
  raiseWindow: (handle: number) => Promise<void>;
  /** Inject one Shift tap — the lock defeat. */
  nudgeInput: () => Promise<void>;
  /** The window that actually holds the foreground right now. */
  foregroundHandle: () => number | null;
  delay: (ms: number) => Promise<void>;
  /** Injectable clock — the verify polls against it, so tests drive the
   *  deadline instead of busy-spinning through a real 700 ms. */
  now: () => number;
};

export const defaultFocusDeps: FocusDeps = {
  raiseWindow: async (handle) => {
    await loadNutInput().providerRegistry.getWindow().focusWindow(handle);
  },
  nudgeInput: async () => {
    const nut = loadNutInput();
    const shift = nut.Key["LeftShift"];
    if (shift === undefined) return;
    await nut.keyboard.pressKey(shift);
    await nut.keyboard.releaseKey(shift);
  },
  foregroundHandle: () => findForegroundWindow()?.handle ?? null,
  delay: realDelay,
  now: () => Date.now(),
};

async function isForeground(
  handle: number,
  deps: FocusDeps,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    if (deps.foregroundHandle() === handle) return true;
    if (deps.now() >= deadline) return false;
    await deps.delay(FOCUS_VERIFY_INTERVAL_MS);
  }
}

/**
 * Bring one window to the front and VERIFY it took.
 *
 * Returns whether the window is verifiably foreground — a `false` is a KNOWN
 * failure the caller can surface ("click the window once and retry"), never a
 * silent one.
 *
 * A window that is already in front returns true immediately, injecting
 * nothing: the cheapest correct answer, and it keeps a stray Shift out of the
 * user's app on the common path.
 *
 * ⚠ This raises the window; it must NEVER resize it. libnut's `SW_RESTORE`
 * un-minimizes while preserving a maximized window's maximized state, which is
 * exactly the contract wanted here — see `nut-input-loader.ts`.
 */
export async function focusWindowHandle(
  handle: number,
  deps: FocusDeps = defaultFocusDeps,
): Promise<boolean> {
  if (!Number.isInteger(handle) || handle <= 0) return false;
  try {
    if (deps.foregroundHandle() === handle) return true;
    for (const attempt of [0, 1]) {
      // The lock defeat, then the settle, then the raise — in this process, in
      // this order. See the header; none of the three is optional.
      await deps.nudgeInput();
      await deps.delay(FOCUS_SETTLE_MS);
      await deps.raiseWindow(handle);
      if (await isForeground(handle, deps, FOCUS_VERIFY_TIMEOUT_MS))
        return true;
      // One retry only. A second failure is a real refusal (an elevated window,
      // a racing user), and retrying harder would just inject more keystrokes
      // into whatever the user is doing.
      if (attempt === 1) return false;
    }
    return false;
  } catch {
    // Best-effort by design — a missing native binary or a dead handle is "not
    // focused", never a thrown turn failure.
    return false;
  }
}

/**
 * Bring a PID's frontmost window to the front — the pid-addressed entry point
 * the Electron wake uses.
 *
 * Kept as the shape `runWakeLoop` already depends on. It resolves the pid to a
 * REAL HWND first, which is the fix for the multi-window case:
 * `Get-Process().MainWindowHandle` collapses an app's windows to one handle and
 * reports 0 for a tray app, so the old path could aim at a stub window or at
 * nothing.
 */
export async function ensureForeground(
  pid: number,
  deps: FocusDeps = defaultFocusDeps,
  listWindows: () => ReturnType<typeof listDesktopWindows> = listDesktopWindows,
): Promise<boolean> {
  let target: number | null = null;
  try {
    target = topWindowForPid(listWindows(), pid)?.handle ?? null;
  } catch {
    return false;
  }
  if (target === null) return false;
  return focusWindowHandle(target, deps);
}

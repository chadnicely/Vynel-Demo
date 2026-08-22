import { describe, it, expect } from "vitest";
import {
  focusWindowHandle,
  ensureForeground,
  type FocusDeps,
} from "./window-focus.js";
import type { DesktopWindow } from "./desktop-windows.js";

/** Drive focus with a fake desktop: `raiseWindow` succeeds only while
 *  `lockOpen` is true, modelling Windows' foreground lock. No native binary, no
 *  real clock. */
function fakeDesktop(options: {
  foreground: number | null;
  raiseWorks?: boolean;
}): {
  deps: FocusDeps;
  calls: string[];
  foreground: () => number | null;
} {
  const calls: string[] = [];
  let foreground = options.foreground;
  // A fake clock advanced BY the fake delay, so the verify's deadline is
  // reached deterministically instead of busy-spinning through a real 700 ms.
  let clock = 0;
  const deps: FocusDeps = {
    raiseWindow: async (handle) => {
      calls.push(`raise:${handle}`);
      if (options.raiseWorks !== false) foreground = handle;
    },
    nudgeInput: async () => {
      calls.push("nudge");
    },
    foregroundHandle: () => foreground,
    delay: async (ms) => {
      calls.push("delay");
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, foreground: () => foreground };
}

describe("focusWindowHandle", () => {
  it("injects input BEFORE raising, with a settle between — the only order that works", async () => {
    // Measured 2026-08-22: bare SetForegroundWindow is refused 0/9; a keystroke
    // from THIS process first makes it 9/9; and back-to-back (no settle) it
    // drops to 0/9. All three parts are load-bearing, so the order is pinned.
    const { deps, calls } = fakeDesktop({ foreground: 999 });
    await expect(focusWindowHandle(42, deps)).resolves.toBe(true);
    expect(calls.slice(0, 3)).toEqual(["nudge", "delay", "raise:42"]);
  });

  it("injects NOTHING when the window is already in front", async () => {
    // A stray Shift lands in whatever the user has focused, so the common path
    // must not pay that cost for a window that is already there.
    const { deps, calls } = fakeDesktop({ foreground: 42 });
    await expect(focusWindowHandle(42, deps)).resolves.toBe(true);
    expect(calls).toEqual([]);
  });

  it("NEVER resizes — raising is not permission to change geometry", async () => {
    // The regression guard for the bug this arc shipped at Kafi: a
    // SW_SHOWNOACTIVATE-style restore silently un-maximized two of his windows,
    // and nothing in the return value showed it. `raiseWindow` (libnut
    // SW_RESTORE) is the ONLY window call focus is allowed to make.
    const { deps, calls } = fakeDesktop({ foreground: 999 });
    await focusWindowHandle(42, deps);
    const windowCalls = calls.filter((call) => call.startsWith("raise"));
    expect(windowCalls).toEqual(["raise:42"]);
    expect(
      calls.some((call) =>
        /minimize|maximize|resize|bounds|normal/i.test(call),
      ),
    ).toBe(false);
  });

  it("retries ONCE when the foreground does not move, then reports a known failure", async () => {
    const { deps, calls } = fakeDesktop({ foreground: 999, raiseWorks: false });
    await expect(focusWindowHandle(42, deps)).resolves.toBe(false);
    // Exactly two attempts — retrying harder would only inject more keystrokes
    // into whatever the user is doing.
    expect(calls.filter((call) => call === "nudge")).toHaveLength(2);
  });

  it("rejects a non-handle without touching the desktop", async () => {
    const { deps, calls } = fakeDesktop({ foreground: 999 });
    await expect(focusWindowHandle(0, deps)).resolves.toBe(false);
    await expect(focusWindowHandle(-1, deps)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("degrades to false when the input engine throws — never a thrown turn failure", async () => {
    const deps: FocusDeps = {
      raiseWindow: async () => {},
      nudgeInput: async () => {
        throw new Error("native binary missing");
      },
      foregroundHandle: () => 999,
      delay: async () => {},
      now: () => 0,
    };
    await expect(focusWindowHandle(42, deps)).resolves.toBe(false);
  });
});

describe("ensureForeground", () => {
  const window = (handle: number, pid: number, z: number): DesktopWindow => ({
    handle,
    pid,
    appName: "Google Chrome",
    title: `w${handle}`,
    minimized: false,
    maximized: false,
    z,
  });

  it("resolves the pid to its FRONTMOST window — the multi-window fix", async () => {
    // The old path went through Get-Process().MainWindowHandle: one handle per
    // process, so an app with several windows could be aimed at a stub.
    const { deps, calls } = fakeDesktop({ foreground: 999 });
    const windows = [window(11, 5488, 5), window(22, 5488, 900)];
    await expect(ensureForeground(5488, deps, () => windows)).resolves.toBe(
      true,
    );
    expect(calls).toContain("raise:22");
    expect(calls).not.toContain("raise:11");
  });

  it("reports false for a pid that owns no window (tray-hidden) without acting", async () => {
    const { deps, calls } = fakeDesktop({ foreground: 999 });
    await expect(ensureForeground(4242, deps, () => [])).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("degrades to false when the window roster throws", async () => {
    const { deps } = fakeDesktop({ foreground: 999 });
    await expect(
      ensureForeground(1, deps, () => {
        throw new Error("capture binary missing");
      }),
    ).resolves.toBe(false);
  });
});

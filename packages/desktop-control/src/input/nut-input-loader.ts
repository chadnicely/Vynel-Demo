// The SINGLE point that loads nut.js — the synthetic input engine behind
// COORDINATE desktop control (move/click/type/press/scroll/drag at a pixel,
// the "act like a human on the desktop" path that pairs with screenshot_app
// when no accessibility tree exists). Kept as the one native touchpoint for
// input, mirroring `a11y/xa11y-loader.ts`.
//
// nut.js is a native CJS module (its libnut provider is a prebuilt .node). It
// is loaded LAZILY via `createRequire` on the first input op — so importing
// this module in tests or on a platform without the prebuilt never pulls the
// binary. The typed surface below is the exact subset we call, verified against
// nut.js 4.2.x's own type defs (every method is async; Button is a numeric enum;
// Key is a numeric-enum record; Point is `new Point(x, y)`).

import { createRequire } from 'node:module'

export interface NutPoint {
  x: number
  y: number
}

/**
 * Real-HWND window operations, reached through nut.js's public
 * `providerRegistry`.
 *
 * `focusWindow` is libnut's, and what it does matters: `ShowWindow(SW_RESTORE)`
 * when the window is iconic, then `SetForegroundWindow`. `SW_RESTORE` is the
 * SAFE restore — it returns a maximized-then-minimized window to MAXIMIZED and
 * never promotes a normal window. (`SW_SHOWNOACTIVATE` does not: it drops the
 * maximized state, which silently un-maximized two of Kafi's windows during the
 * focus research.)
 *
 * ⚠ `focusWindow`'s boolean is `SetForegroundWindow`'s, and it LIES — measured
 * refused-but-true. Never trust it; verify against the real foreground.
 */
export interface NutWindowProvider {
  focusWindow(handle: number): Promise<boolean>
  getActiveWindow(): Promise<number>
}

export interface NutModule {
  mouse: {
    config: { autoDelayMs: number }
    setPosition(target: NutPoint): Promise<unknown>
    /** Where the cursor is. ⚠ MIS-REPORTS on a fractionally-scaled monitor
     *  (measured 2026-08-11 against Win32 GetCursorPos): it answers in a
     *  different space than `setPosition` accepts. Exposed only because a
     *  relative gesture needs a starting point on the PRIMARY display — never
     *  use it to verify where a click landed. */
    getPosition(): Promise<NutPoint>
    leftClick(): Promise<unknown>
    rightClick(): Promise<unknown>
    click(button: number): Promise<unknown>
    doubleClick(button: number): Promise<unknown>
    scrollDown(amount: number): Promise<unknown>
    scrollUp(amount: number): Promise<unknown>
    scrollLeft(amount: number): Promise<unknown>
    scrollRight(amount: number): Promise<unknown>
    drag(path: NutPoint[]): Promise<unknown>
    /** Hold a button down / let it go — the two halves a stepped drag needs
     *  (`drag()` alone jumps A→B, which most drop targets ignore). */
    pressButton(button: number): Promise<unknown>
    releaseButton(button: number): Promise<unknown>
    /** Move along an explicit path — the intermediate motion events that make
     *  OLE/XDND drag-and-drop actually register. */
    move(path: NutPoint[]): Promise<unknown>
  }
  keyboard: {
    config: { autoDelayMs: number }
    type(...input: Array<string | number>): Promise<unknown>
    pressKey(...keys: number[]): Promise<unknown>
    releaseKey(...keys: number[]): Promise<unknown>
  }
  /** The OS clipboard. nut.js ships it, so no second clipboard dependency. */
  clipboard: {
    getContent(): Promise<string>
    setContent(content: string): Promise<unknown>
  }
  Point: new (x: number, y: number) => NutPoint
  Button: { LEFT: number; MIDDLE: number; RIGHT: number }
  Key: Record<string, number>
  /** nut.js's public provider registry — the supported route to the window
   *  provider, rather than reaching past it into the platform-specific
   *  `libnut-win32` binary (which is not a direct dependency of this package). */
  providerRegistry: { getWindow(): NutWindowProvider }
}

let cachedModule: NutModule | undefined

export function loadNutInput(): NutModule {
  if (cachedModule !== undefined) {
    return cachedModule
  }
  try {
    const requireFromHere = createRequire(import.meta.url)
    const nut = requireFromHere('@nut-tree-fork/nut-js') as NutModule
    // Small auto-delays make chorded keys + rapid clicks land reliably on a
    // busy desktop; the default 100ms is sluggish for typing.
    nut.keyboard.config.autoDelayMs = 4
    nut.mouse.config.autoDelayMs = 8
    cachedModule = nut
    return cachedModule
  } catch (cause) {
    throw new Error(
      'Desktop input is unavailable: the nut.js input engine failed to load (it needs the prebuilt ' +
        'native binary for this OS/arch). ' +
        (cause instanceof Error ? cause.message : String(cause)),
    )
  }
}

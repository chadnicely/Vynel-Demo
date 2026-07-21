// App resolution + the Electron accessibility-tree wake. UIA ENUMERATION
// (`App.find`) first — works for native + Qt apps (e.g. Telegram). If that
// misses, an open-but-unenumerated app is the Electron/Chromium case (Discord,
// Slack): reach it by pid and WAKE its renderer tree — set the screen-reader
// flag, attach a UIA event subscription, verifiably focus the window, then POLL
// until the tree turns non-trivial (instead of one fixed sleep: a warm app
// resolves in ~1-2s, a cold Discord gets the full deadline). The subscription +
// flag are HELD in `dispose` (Chromium drops the woken tree once no UIA client
// listens), so the caller reads/acts FIRST, then calls `dispose()`.
//
// On deadline expiry the last-resolved app is returned anyway (a partial tree
// beats nothing) with `wakeIncomplete: true` + the verified focus outcome, so
// the tool can tell the user exactly what to do ("click the window and retry")
// instead of a bare empty tree.

import {
  closeSubscription,
  dumpApp,
  withTimeout,
  type Xa11yAppInstance,
  type Xa11yModule,
  type Xa11ySubscription,
} from './xa11y-loader.js'
import { isAppNameMatch } from './app-name-match.js'
import { findWindowedPidByName } from './windowed-process.js'
import { ensureForeground } from './window-focus.js'
import { screenReaderFlag } from './screen-reader-flag.js'

// Shorter timeout for the UIA-enumeration attempt: an already-open app matches
// near-instantly, so a 2.5s miss means "not enumerated" (the Electron case) —
// fail fast to the byPid fallback instead of waiting the full lookup timeout.
export const APP_FIND_TIMEOUT_MS = 2500
export const APP_LOOKUP_TIMEOUT_MS = 6000
// The wake's overall bound — a cold Discord needs well over the old fixed 3s;
// the snapshot tool's own 25s timeout still bounds everything above this.
export const ELECTRON_WAKE_DEADLINE_MS = 12000
export const WAKE_POLL_INTERVAL_MS = 750
// Shallow probe depth — enough to tell "woken web contents" from "bare frame"
// without paying for a full-depth dump every poll.
const WAKE_PROBE_DEPTH = 10
// Each probe dump is bounded — a custom-drawn control can make xa11y's dump
// hang indefinitely, and the wake deadline is only checked BETWEEN probes, so
// an unbounded probe would defeat the deadline (and the package's "never hang
// the brain" backstop). A timed-out probe reads as a trivial tree.
const WAKE_PROBE_TIMEOUT_MS = 4000

const NO_OP = (): void => {}
const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type ResolvedApp = {
  app: Xa11yAppInstance
  dispose: () => void
  viaElectronWake: boolean
  /** Electron wake only: the deadline expired before the tree turned non-trivial. */
  wakeIncomplete: boolean
  /** Electron wake only (null otherwise): whether the window verifiably took focus. */
  focusSucceeded: boolean | null
}

/**
 * Whether a probe dump looks like woken web contents rather than the bare
 * window frame. A dead Chromium tree is the window + a pane (1-4 lines); a
 * woken one carries a `document` node and many descendants.
 */
export function isTreeNonTrivial(dump: string): boolean {
  const lines = dump.split('\n').filter((line) => line.trim().length > 0)
  return lines.length >= 8 || /\bdocument\b/i.test(dump)
}

// The wake loop's injectable seams — unit tests drive the loop with fakes (no
// native binary, no PowerShell, no real clock).
export type WakeLoopDeps = {
  resolveApp: () => Promise<Xa11yAppInstance>
  probeTree: (app: Xa11yAppInstance) => Promise<string>
  ensureForeground: () => Promise<boolean>
  delay: (ms: number) => Promise<void>
  now: () => number
  deadlineMs?: number
}

export type WakeLoopResult = {
  app: Xa11yAppInstance
  wakeIncomplete: boolean
  focusSucceeded: boolean
}

/**
 * Poll until the app's tree turns non-trivial or the deadline expires. If the
 * first focus attempt failed, retries focus ONCE at the halfway mark (the tree
 * may need only the focus event, not more time).
 */
export async function runWakeLoop(deps: WakeLoopDeps): Promise<WakeLoopResult> {
  const deadlineMs = deps.deadlineMs ?? ELECTRON_WAKE_DEADLINE_MS
  const deadline = deps.now() + deadlineMs
  let focusSucceeded = await deps.ensureForeground()
  let retriedFocus = false
  let app = await deps.resolveApp()
  for (;;) {
    // A probe failure (custom-drawn control, transient UIA error) reads as a
    // trivial tree — the loop keeps polling until the deadline handles it.
    const probe = await deps.probeTree(app).catch(() => '')
    if (isTreeNonTrivial(probe)) {
      return { app, wakeIncomplete: false, focusSucceeded }
    }
    const remaining = deadline - deps.now()
    if (remaining <= 0) {
      return { app, wakeIncomplete: true, focusSucceeded }
    }
    if (!focusSucceeded && !retriedFocus && remaining <= deadlineMs / 2) {
      retriedFocus = true
      focusSucceeded = await deps.ensureForeground()
    }
    await deps.delay(Math.min(WAKE_POLL_INTERVAL_MS, remaining))
    app = await deps.resolveApp()
  }
}

// The resolution path's injectable seams (the OS/flag side; the xa11y side is
// the `App` parameter itself, fakeable in tests).
export type ResolveAppHooks = {
  findPid: (query: string) => Promise<number | null>
  ensureForeground: (pid: number) => Promise<boolean>
  acquireScreenReaderFlag: () => Promise<() => void>
  delay: (ms: number) => Promise<void>
  now: () => number
}

export const defaultResolveAppHooks: ResolveAppHooks = {
  findPid: findWindowedPidByName,
  ensureForeground,
  acquireScreenReaderFlag: () => screenReaderFlag.acquire(),
  delay: defaultDelay,
  now: () => Date.now(),
}

/** Resolve a named app to an xa11y App, transparently waking Electron apps. */
export async function resolveAppWithFallback(
  App: Xa11yModule['App'],
  query: string,
  intent: 'read' | 'act on',
  hooks: ResolveAppHooks = defaultResolveAppHooks,
): Promise<ResolvedApp> {
  try {
    const app = await App.find((candidate) => isAppNameMatch(candidate.name, query), {
      timeout: APP_FIND_TIMEOUT_MS,
    })
    return { app, dispose: NO_OP, viaElectronWake: false, wakeIncomplete: false, focusSucceeded: null }
  } catch (findError) {
    const pid = await hooks.findPid(query)
    if (pid === null) {
      throw new Error(
        `Could not ${intent} "${query}": no matching app is open. Call list_open_apps to see available apps.`,
        { cause: findError },
      )
    }
    const initial = await App.byPid(pid, { timeout: APP_LOOKUP_TIMEOUT_MS })
    // Screen-reader flag BEFORE the subscription — Chromium reads it when the
    // subscription's presence triggers accessibility activation.
    const releaseFlag = await hooks.acquireScreenReaderFlag()
    let subscription: Xa11ySubscription
    try {
      subscription = await initial.subscribe()
    } catch (subscribeError) {
      releaseFlag()
      throw subscribeError
    }
    const dispose = (): void => {
      closeSubscription(subscription)
      releaseFlag()
    }
    try {
      const wake = await runWakeLoop({
        resolveApp: () => App.byPid(pid, { timeout: APP_LOOKUP_TIMEOUT_MS }),
        probeTree: (app) =>
          withTimeout(dumpApp(app, WAKE_PROBE_DEPTH), WAKE_PROBE_TIMEOUT_MS, 'wake probe'),
        ensureForeground: () => hooks.ensureForeground(pid),
        delay: hooks.delay,
        now: hooks.now,
      })
      return {
        app: wake.app,
        dispose,
        viaElectronWake: true,
        wakeIncomplete: wake.wakeIncomplete,
        focusSucceeded: wake.focusSucceeded,
      }
    } catch (wakeError) {
      // A throw anywhere before handing back `dispose` must release the held
      // subscription + flag HERE — else they leak with no dispose handle.
      dispose()
      throw wakeError
    }
  }
}

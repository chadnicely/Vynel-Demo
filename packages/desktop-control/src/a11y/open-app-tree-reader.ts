// A held tree reader — resolve an app ONCE, read it many times, dispose at the
// end. Split from `xa11y-adapter.ts` because it is a self-contained lifetime
// with its own hazard (see below), and because the adapter had grown past the
// file-size rule.

import { loadXa11y, dumpApp, withTimeout, resolveDesktopTimeout } from './xa11y-loader.js'
import { resolveAppWithFallback } from './electron-wake.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

const DEFAULT_SNAPSHOT_MAX_DEPTH = 12
const ELECTRON_SNAPSHOT_MAX_DEPTH = 25
const MAX_SNAPSHOT_MAX_DEPTH = 40
const SNAPSHOT_TIMEOUT_MS = 25000

export type OpenAppTreeReaderOptions = {
  maxDepth?: number
  /** Raise the read timeout for a slow app; clamped by `resolveDesktopTimeout`. */
  timeoutMs?: number
}

/** A resolved app whose tree can be read REPEATEDLY without re-resolving.
 *  `dispose` must always be called — it releases the Electron wake. */
export type AppTreeReader = {
  readTree: () => Promise<string>
  dispose: () => void
  /** True when the app needed the Electron wake — i.e. holding it matters. */
  viaElectronWake: boolean
}

/**
 * Resolve an app ONCE and hold it open for repeated tree reads.
 *
 * WHY this exists, and why polling `snapshotApp` is not an acceptable
 * substitute. `snapshotApp` disposes its resolution in a `finally`, so every
 * call to it is a COLD resolve. On an Electron app that means a full wake each
 * time: un-minimize the user's window, steal the foreground, and — when
 * activation is refused — send a bare Alt keypress into whatever they are
 * currently typing, plus set-then-clear the GLOBAL `SPI_SETSCREENREADER` flag.
 * `window-focus.ts` accepts that side effect explicitly because it "fires at
 * most once per wake"; a caller that wakes in a loop breaks the very invariant
 * that made it acceptable. It also races itself — one poll's fire-and-forget
 * flag clear can land after the next poll's set, leaving the flag OFF for that
 * whole wake so Chromium never builds the tree.
 *
 * So a poller resolves once, reads many times, and disposes at the end.
 * `authorize` still runs on EVERY read (a cheap sync grant lookup), so access
 * revoked mid-poll stops the next read rather than being checked only up front.
 */
export async function openAppTreeReader(
  query: string,
  authorize?: DesktopAccessAuthorizer,
  options: OpenAppTreeReaderOptions = {},
): Promise<AppTreeReader> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    throw new Error('openAppTreeReader: an app name (or part of it) is required.')
  }
  const { App } = loadXa11y()
  // CAPTURE the name resolution hands the authorizer — that is the CANONICAL
  // grant identity, resolved through the pid. It is NOT `resolved.app.name`:
  // xa11y names an app by its active WINDOW TITLE, so Discord arrives as
  // "music | localhost - Discord" and a grant for "Discord" would never match
  // it. Re-authorizing on that string denied a wait the user had just
  // approved (live smoke, 2026-08-11) — exactly the trap `resolveAppIdentity`
  // exists to close.
  let canonicalName: string | null = null
  const resolved = await resolveAppWithFallback(App, trimmedQuery, 'read', undefined, (appName) => {
    canonicalName = appName
    authorize?.(appName, 'read')
  })
  const defaultDepth = resolved.viaElectronWake
    ? ELECTRON_SNAPSHOT_MAX_DEPTH
    : DEFAULT_SNAPSHOT_MAX_DEPTH
  const maxDepth = Math.min(options.maxDepth ?? defaultDepth, MAX_SNAPSHOT_MAX_DEPTH)
  return {
    viaElectronWake: resolved.viaElectronWake,
    readTree: async () => {
      // Re-checked per read against the CANONICAL identity, so a grant revoked
      // mid-poll stops the next read. Skipped only if resolution never reported
      // one — re-checking a name we aren't sure of would deny work the user
      // already approved, and the up-front check has already run.
      if (canonicalName !== null) authorize?.(canonicalName, 'read')
      // Deliberately NO `retryUpToMs`: the only caller (`wait_for`) cannot pass
      // a read timeout through, so promising "retry with timeoutMs up to N"
      // would send the model to bump wait_for's OWN `timeoutMs` — which is the
      // wait duration, capped lower than the number it was just promised. It
      // would raise the wrong knob, get clamped, and keep failing at 25s.
      return withTimeout(
        dumpApp(resolved.app, maxDepth),
        resolveDesktopTimeout(options.timeoutMs, SNAPSHOT_TIMEOUT_MS),
        'snapshot',
      )
    },
    dispose: () => {
      resolved.dispose()
    },
  }
}

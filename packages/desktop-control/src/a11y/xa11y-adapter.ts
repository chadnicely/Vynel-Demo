// The desktop a11y public API — list / snapshot / act. The `a11y/` folder is
// the accessibility boundary: `xa11y-loader.ts` is the single native require
// point, `electron-wake.ts` owns app resolution + the Chromium tree wake, and
// this file composes them into the operations the MCP tools call.

import { loadXa11y, dumpApp, withTimeout } from './xa11y-loader.js'
import { resolveAppWithFallback } from './electron-wake.js'
import { isAppNameMatch } from './app-name-match.js'
import { isPasswordControl, passwordControlRefusal } from './password-control-guard.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

// Re-exported so the public surface (index.ts) and the MCP tools keep one
// import point for the a11y operations.
export { isAppNameMatch }

const DEFAULT_SNAPSHOT_MAX_DEPTH = 12
// Deeper default ONLY for the Electron-wake path: Chromium renderer trees are
// deep (Discord's useful content sits ~15-25 levels down), so 12 returns just
// the top. Enumerated apps keep the shallower default — including Chromium
// BROWSERS (Chrome is also Chromium but reached via App.find), which would
// otherwise dump thousands of nodes unprompted. A caller-supplied maxDepth wins.
const ELECTRON_SNAPSHOT_MAX_DEPTH = 25
const MAX_SNAPSHOT_MAX_DEPTH = 40

const ACT_TIMEOUT_MS = 15000
const SNAPSHOT_TIMEOUT_MS = 25000
// App enumeration is normally sub-second; a long bound here means one wedged
// provider, not a slow desktop.
const LIST_TIMEOUT_MS = 10000

export type OpenApp = {
  name: string
  pid: number | null
}

/** List the apps xa11y can see (those exposing an accessibility tree), for targeting. */
export async function listOpenApps(): Promise<OpenApp[]> {
  const { App } = loadXa11y()
  // Bounded like every other a11y op — a single wedged UIA provider can make the
  // native enumeration block indefinitely, and this is an ALWAYS-ON tool, so an
  // unbounded call hangs the whole turn (the "never hang the brain" rule, which
  // snapshot/act already honor but this path had missed).
  const apps = await withTimeout(App.list(), LIST_TIMEOUT_MS, 'app list')
  return apps
    .map((app) => ({ name: app.name, pid: app.pid }))
    .filter((app) => app.name.length > 0)
}

export type SnapshotAppOptions = {
  maxDepth?: number
}

export type AppSnapshot = {
  tree: string
  /** Electron wake only: the wake deadline expired before the tree turned non-trivial. */
  wakeIncomplete: boolean
  /** Electron wake only (null otherwise): whether the window verifiably took focus. */
  focusSucceeded: boolean | null
}

/**
 * Read a named app's accessibility tree as an indented role/name/value dump
 * (xa11y's `app.dump`). `query` is matched case-insensitively as a substring of
 * the app name. Native + Qt apps resolve via UIA enumeration; Electron apps
 * (not enumerated, tree off by default) are reached by pid and woken
 * automatically (`electron-wake.ts`). The wake outcome rides the result so the
 * tool can turn an empty tree into actionable guidance. Throws an actionable
 * error if the app isn't open.
 */
export async function snapshotApp(
  query: string,
  options: SnapshotAppOptions = {},
  authorize?: DesktopAccessAuthorizer,
): Promise<AppSnapshot> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    throw new Error('snapshotApp: an app name (or part of it) is required — name the app to look at.')
  }
  const { App } = loadXa11y()
  // Enforcement rides the resolution seam: it fires on the RESOLVED identity
  // (never the fuzzy query) and BEFORE the Electron wake actuates anything —
  // a denied app must not be foregrounded or woken.
  const resolved = await resolveAppWithFallback(App, trimmedQuery, 'read', undefined, (appName) =>
    authorize?.(appName, 'read'),
  )
  // Electron renderer trees are deep — use the deeper default only on that path;
  // keep enumerated apps (incl. Chromium browsers) shallow. Explicit maxDepth wins.
  const defaultDepth = resolved.viaElectronWake ? ELECTRON_SNAPSHOT_MAX_DEPTH : DEFAULT_SNAPSHOT_MAX_DEPTH
  const maxDepth = Math.min(options.maxDepth ?? defaultDepth, MAX_SNAPSHOT_MAX_DEPTH)
  try {
    const tree = await withTimeout(dumpApp(resolved.app, maxDepth), SNAPSHOT_TIMEOUT_MS, 'snapshot')
    return {
      tree,
      wakeIncomplete: resolved.wakeIncomplete,
      focusSucceeded: resolved.focusSucceeded,
    }
  } finally {
    // Release the Electron-wake subscription + flag (a no-op for enumerated apps).
    resolved.dispose()
  }
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
  options: SnapshotAppOptions = {},
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
      return withTimeout(dumpApp(resolved.app, maxDepth), SNAPSHOT_TIMEOUT_MS, 'snapshot')
    },
    dispose: () => {
      resolved.dispose()
    },
  }
}

// The PROVEN minimal action set (each live-verified before shipping — xa11y's
// types alone don't tell us a method actually fires). Extend deliberately, one
// live-verified action at a time. The tool's input enum derives from this, so
// the runtime list and the type can't drift.
export const DESKTOP_ACTIONS = ['press', 'type_text', 'set_value'] as const
export type DesktopAction = (typeof DESKTOP_ACTIONS)[number]

/** Whether an action needs a `value` argument. */
export function actionRequiresValue(action: DesktopAction): boolean {
  return action === 'type_text' || action === 'set_value'
}

export type ActCandidate = { stableId: string | null; role: string; name: string | null }
export type ActOnAppResult =
  | { kind: 'done'; action: DesktopAction; selector: string }
  | { kind: 'ambiguous'; selector: string; matchCount: number; candidates: ActCandidate[] }

const MAX_AMBIGUITY_CANDIDATES = 15

/**
 * Perform an element action on a named app. The element is addressed by a
 * stateless selector (`role[name="…"]` or, for precision, `[stable_id="…"]`
 * from a snapshot). If the selector is ambiguous (matches >1), NO action runs —
 * the matches are returned with their `stable_id`s so the caller can re-target
 * one precisely. Throws on no-match / invalid selector / missing value.
 */
/** The tier a given element action needs: pressing is `click`; entering text is `full`. */
export function requiredTierForAction(action: DesktopAction): 'click' | 'full' {
  return action === 'press' ? 'click' : 'full'
}

export async function actOnApp(
  appName: string,
  selector: string,
  action: DesktopAction,
  value?: string,
  authorize?: DesktopAccessAuthorizer,
): Promise<ActOnAppResult> {
  // Fail CLOSED on a blank target: `isAppNameMatch(name, '')` matches everything,
  // so an empty/whitespace app would act on an arbitrary window. Guard the
  // mutating path exactly like the read path (`snapshotApp`).
  const trimmedApp = appName.trim()
  if (trimmedApp.length === 0) {
    throw new Error('actOnApp: an app name is required — name the app to act on.')
  }
  if (selector.trim().length === 0) {
    throw new Error('actOnApp: an element selector is required (from snapshot_app).')
  }
  if (actionRequiresValue(action) && (value === undefined || value.length === 0)) {
    throw new Error(`The "${action}" action requires a non-empty value.`)
  }
  const { App } = loadXa11y()
  // Enforcement rides the resolution seam — see snapshotApp.
  const resolved = await resolveAppWithFallback(App, trimmedApp, 'act on', undefined, (appName) =>
    authorize?.(appName, requiredTierForAction(action)),
  )
  try {
    const locator = resolved.app.locator(selector)
    let matchCount: number
    try {
      matchCount = await locator.count()
    } catch (cause) {
      throw new Error(
        `Invalid selector "${selector}". Use role[name="…"] or [stable_id="…"] from snapshot_app.`,
        { cause },
      )
    }
    if (matchCount === 0) {
      throw new Error(
        `No element in "${appName}" matches "${selector}". Re-snapshot the app and check the role/name.`,
      )
    }
    if (matchCount > 1) {
      const elements = await locator.elements()
      const candidates = elements
        .slice(0, MAX_AMBIGUITY_CANDIDATES)
        .map((element) => ({ stableId: element.stableId, role: element.role, name: element.name }))
      return { kind: 'ambiguous', selector, matchCount, candidates }
    }

    // The credentials hard wall: NEVER type into a password control. Checked on
    // the single-match element BEFORE any typing action fires; detection has no
    // override. (Pressing a password field — e.g. to focus it FOR the user — is
    // deliberately allowed; entering the value is not.)
    if (actionRequiresValue(action)) {
      const [element] = await withTimeout(locator.elements(), ACT_TIMEOUT_MS, 'inspect')
      if (element === undefined) {
        // Fail CLOSED: the wall can't inspect what it can't read (a UI-change
        // race between count() and elements()) — typing blind is not an option.
        throw new Error(
          `The matched element in "${appName}" changed before it could be inspected — no text was ` +
            'entered. Re-snapshot the app and retry.',
        )
      }
      if (isPasswordControl(element)) {
        throw new Error(passwordControlRefusal(appName))
      }
    }

    switch (action) {
      case 'press':
        await withTimeout(locator.press(), ACT_TIMEOUT_MS, 'press')
        break
      case 'type_text':
        await withTimeout(locator.typeText(value ?? ''), ACT_TIMEOUT_MS, 'type_text')
        break
      case 'set_value':
        await withTimeout(locator.setValue(value ?? ''), ACT_TIMEOUT_MS, 'set_value')
        break
      default: {
        // Exhaustiveness guard — a new DesktopAction MUST add a case above; else it
        // would fall through and falsely report "done" without acting (a defect on
        // the mutating surface). This makes that a compile error.
        const unhandled: never = action
        throw new Error(`Unsupported desktop action: ${String(unhandled)}`)
      }
    }
    return { kind: 'done', action, selector }
  } finally {
    // Release the Electron-wake subscription + flag (a no-op for enumerated apps).
    resolved.dispose()
  }
}

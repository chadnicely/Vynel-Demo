// The desktop a11y public API — list / snapshot / act. The `a11y/` folder is
// the accessibility boundary: `xa11y-loader.ts` is the single native require
// point, `electron-wake.ts` owns app resolution + the Chromium tree wake, and
// this file composes them into the operations the MCP tools call.

import { loadXa11y, dumpApp, withTimeout } from './xa11y-loader.js'
import { resolveAppWithFallback } from './electron-wake.js'
import { isAppNameMatch } from './app-name-match.js'

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

export type OpenApp = {
  name: string
  pid: number | null
}

/** List the apps xa11y can see (those exposing an accessibility tree), for targeting. */
export async function listOpenApps(): Promise<OpenApp[]> {
  const { App } = loadXa11y()
  const apps = await App.list()
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
): Promise<AppSnapshot> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    throw new Error('snapshotApp: an app name (or part of it) is required — name the app to look at.')
  }
  const { App } = loadXa11y()
  const resolved = await resolveAppWithFallback(App, trimmedQuery, 'read')
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
export async function actOnApp(
  appName: string,
  selector: string,
  action: DesktopAction,
  value?: string,
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
  const resolved = await resolveAppWithFallback(App, trimmedApp, 'act on')
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

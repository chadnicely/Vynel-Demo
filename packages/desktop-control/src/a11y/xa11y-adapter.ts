// The desktop a11y public API — list / snapshot / act. The `a11y/` folder is
// the accessibility boundary: `xa11y-loader.ts` is the single native require
// point, `electron-wake.ts` owns app resolution + the Chromium tree wake, and
// this file composes them into the operations the MCP tools call.

import {
  loadXa11y,
  dumpApp,
  withTimeout,
  resolveDesktopTimeout,
  MAX_DESKTOP_TIMEOUT_MS,
} from './xa11y-loader.js'
import { resolveAppWithFallback } from './electron-wake.js'
import { isAppNameMatch } from './app-name-match.js'
import { isPasswordControl, passwordControlRefusal } from './password-control-guard.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'
import { verifyTypedValue, type ActVerification } from './act-verification.js'

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
  /** Raise the read timeout for a slow app; clamped to MAX_DESKTOP_TIMEOUT_MS. */
  timeoutMs?: number
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
  // Reading is ungated: no per-app grant to enforce, so resolution no longer
  // carries an identity callback. The identity work it does still matters —
  // it is what the plan envelope and the activity log name — but nothing is
  // refused on the way in.
  const resolved = await resolveAppWithFallback(App, trimmedQuery, 'read')
  // Electron renderer trees are deep — use the deeper default only on that path;
  // keep enumerated apps (incl. Chromium browsers) shallow. Explicit maxDepth wins.
  const defaultDepth = resolved.viaElectronWake ? ELECTRON_SNAPSHOT_MAX_DEPTH : DEFAULT_SNAPSHOT_MAX_DEPTH
  const maxDepth = Math.min(options.maxDepth ?? defaultDepth, MAX_SNAPSHOT_MAX_DEPTH)
  try {
    const timeoutMs = resolveDesktopTimeout(options.timeoutMs, SNAPSHOT_TIMEOUT_MS)
    const tree = await withTimeout(dumpApp(resolved.app, maxDepth), timeoutMs, 'snapshot', {
      retryUpToMs: MAX_DESKTOP_TIMEOUT_MS,
    })
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
  | {
      kind: 'done'
      action: DesktopAction
      selector: string
      /** Present for the VALUE actions only — a press cannot be verified in
       *  general, and claiming otherwise would be worse than saying nothing. */
      verification?: ActVerification
    }
  | { kind: 'ambiguous'; selector: string; matchCount: number; candidates: ActCandidate[] }

const MAX_AMBIGUITY_CANDIDATES = 15
/** How often to re-read while waiting for the input to appear, and how long to
 *  keep trying. A single fixed sleep was the first version and was the very risk
 *  its own comment warned about: a slow Electron or web-view field had not
 *  applied the text yet, so the read-back reported a false MISMATCH — and that
 *  now writes `failed` into an append-only row, so the wrong answer is permanent.
 *  Polling stops at the first match, so the common case is still one read. */
const VERIFY_POLL_MS = 100
const VERIFY_DEADLINE_MS = 1200

/** Re-read the element and compare. Any failure to read is reported as
 *  UNVERIFIABLE rather than swallowed — the whole point is to stop claiming
 *  outcomes we have not seen. */
async function readBackValue(
  locator: { elements(): Promise<Array<{ value: string | null }>> },
  action: 'type_text' | 'set_value',
  intended: string,
  valueBefore: string | null,
): Promise<ActVerification> {
  try {
    const deadline = Date.now() + VERIFY_DEADLINE_MS
    let latest: ActVerification = {
      kind: 'unverifiable',
      reason: 'the element was gone by the time it was re-read',
    }
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS))
      const [element] = await withTimeout(locator.elements(), ACT_TIMEOUT_MS, 'verify')
      if (element !== undefined) {
        latest = verifyTypedValue(action, intended, element.value, valueBefore)
        // Confirmed is final; so is "we cannot tell" (re-reading a control that
        // exposes no value, or a field that already held the text, will never
        // start telling us more).
        if (latest.kind !== 'mismatch') return latest
      }
      if (Date.now() >= deadline) return latest
    }
  } catch (cause) {
    return {
      kind: 'unverifiable',
      reason: `re-reading the element failed (${cause instanceof Error ? cause.message : String(cause)})`,
    }
  }
}

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
    // Captured for the password wall AND for verification: knowing what the
    // field held BEFORE is what stops a read-back confirming text that was
    // already there.
    let valueBefore: string | null = null
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
      valueBefore = element.value
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
    // Read the value BACK. The action returning means the keystrokes were
    // sent, not that they landed where they were aimed — see
    // `act-verification.ts`. Only the value actions can be checked this way.
    if (actionRequiresValue(action)) {
      return {
        kind: 'done',
        action,
        selector,
        verification: await readBackValue(
          locator,
          action as 'type_text' | 'set_value',
          value ?? '',
          valueBefore,
        ),
      }
    }
    return { kind: 'done', action, selector }
  } finally {
    // Release the Electron-wake subscription + flag (a no-op for enumerated apps).
    resolved.dispose()
  }
}

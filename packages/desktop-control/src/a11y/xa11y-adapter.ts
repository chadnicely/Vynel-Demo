// The ONLY file that touches xa11y — the accessibility engine behind desktop
// control. Keeping every xa11y call here means any quirk of the binding (CJS
// interop, selector grammar, error taxonomy) stays contained.
//
// xa11y is a native CJS module. It is loaded LAZILY via `createRequire` on the
// first desktop op — so merely importing this adapter (in tests, or on a
// platform without the prebuilt binary) never pulls the native binary. The type
// comes from `typeof import(...)`, which is erased at compile time (no load).

import { createRequire } from 'node:module'
import { findWindowedPidByName, foregroundWindow } from './windowed-process.js'

type Xa11yModule = typeof import('@crowecawcaw/xa11y')
let cachedXa11y: Xa11yModule | undefined

function loadXa11y(): Xa11yModule {
  if (cachedXa11y !== undefined) {
    return cachedXa11y
  }
  try {
    const requireFromHere = createRequire(import.meta.url)
    cachedXa11y = requireFromHere('@crowecawcaw/xa11y') as Xa11yModule
    return cachedXa11y
  } catch (cause) {
    throw new Error(
      'Desktop control is unavailable: the xa11y accessibility engine failed to load (it needs the ' +
        'prebuilt native binary for this OS/arch). ' +
        (cause instanceof Error ? cause.message : String(cause)),
    )
  }
}

const DEFAULT_SNAPSHOT_MAX_DEPTH = 12
// Deeper default ONLY for the Electron-wake path: Chromium renderer trees are
// deep (Discord's useful content sits ~15-25 levels down), so 12 returns just
// the top. Enumerated apps keep the shallower default — including Chromium
// BROWSERS (Chrome is also Chromium but reached via App.find), which would
// otherwise dump thousands of nodes unprompted. A caller-supplied maxDepth wins.
const ELECTRON_SNAPSHOT_MAX_DEPTH = 20
const MAX_SNAPSHOT_MAX_DEPTH = 40
const APP_LOOKUP_TIMEOUT_MS = 6000
// Shorter timeout for the UIA-enumeration attempt: an already-open app matches
// near-instantly, so a 2.5s miss means "not enumerated" (the Electron case) —
// fail fast to the byPid fallback instead of waiting the full lookup timeout.
const APP_FIND_TIMEOUT_MS = 2500
// How long to let Chromium build its renderer accessibility tree after we attach
// as a UIA event client + focus the window (the proven Electron-wake recipe).
const ELECTRON_WAKE_MS = 3000

export type OpenApp = {
  name: string
  pid: number | null
}

/**
 * Whether an app's name matches the caller's query (case-insensitive substring).
 * Window titles are dynamic ("*Notes.txt - Notepad"), so exact match is wrong —
 * substring lets the model target "Notepad" or "Chrome" without the full title.
 */
export function isAppNameMatch(appName: string, query: string): boolean {
  return appName.toLowerCase().includes(query.trim().toLowerCase())
}

// The native xa11y App instance (what App.find / App.byPid resolve to). Its
// shipped .d.ts omits `dump`/`tree` (present at runtime); cast where used.
type Xa11yAppInstance = Awaited<ReturnType<Xa11yModule['App']['byPid']>>
type Xa11ySubscription = Awaited<ReturnType<Xa11yAppInstance['subscribe']>>

const NO_OP = (): void => {}
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const ACT_TIMEOUT_MS = 15000
const SNAPSHOT_TIMEOUT_MS = 25000

// Hard backstop so a desktop op can NEVER hang the brain. A custom-drawn control
// (Telegram/Qt, some Electron) can make xa11y's press/dump block indefinitely
// (the UIA Invoke never completes); this bounds the wait and surfaces an
// actionable error. The underlying native call may keep running in the
// background, but the tool returns instead of leaving the turn pending forever.
function withTimeout<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Desktop ${label} did not complete within ${ms / 1000}s — the target may be a custom-drawn ` +
            'control (e.g. Telegram/Qt) that does not respond to accessibility actions. Try a different ' +
            'element; some apps can only be read, not acted on this way.',
        ),
      )
    }, ms)
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

// Read an app's tree — xa11y's `dump` isn't in the shipped .d.ts, so cast here.
function dumpApp(app: Xa11yAppInstance, maxDepth: number): Promise<string> {
  return (app as unknown as { dump(maxDepth?: number): Promise<string> }).dump(maxDepth)
}

// Release the held UIA subscription (xa11y's `Subscription.close()`). Best-effort.
function closeSubscription(subscription: Xa11ySubscription): void {
  try {
    if (!subscription.closed) {
      subscription.close()
    }
  } catch {
    // Releasing the listener must never throw to the caller.
  }
}

type ResolvedApp = { app: Xa11yAppInstance; dispose: () => void; viaElectronWake: boolean }

// Resolve a named app to an xa11y App, transparently handling Electron apps.
// UIA ENUMERATION (`App.find`) first — works for native + Qt apps (e.g. Telegram).
// If that misses, an open-but-unenumerated app is the Electron/Chromium case
// (Discord, Slack): reach it by pid (`App.byPid`) and WAKE its renderer
// accessibility tree with the proven recipe — attach a UIA event subscription,
// focus the window, let Chromium build the tree, re-attach. The subscription is
// HELD in `dispose` (the woken tree drops once no UIA client listens), so the
// caller reads/acts FIRST, then calls `dispose()`.
async function resolveAppWithFallback(
  App: Xa11yModule['App'],
  query: string,
  intent: 'read' | 'act on',
): Promise<ResolvedApp> {
  try {
    const app = await App.find((candidate) => isAppNameMatch(candidate.name, query), {
      timeout: APP_FIND_TIMEOUT_MS,
    })
    return { app, dispose: NO_OP, viaElectronWake: false }
  } catch (findError) {
    const pid = await findWindowedPidByName(query)
    if (pid === null) {
      throw new Error(
        `Could not ${intent} "${query}": no matching app is open. Call list_open_apps to see available apps.`,
        { cause: findError },
      )
    }
    const initial = await App.byPid(pid, { timeout: APP_LOOKUP_TIMEOUT_MS })
    // Attach as a UIA event client — Chromium builds its renderer accessibility
    // tree while a client is listening. `subscribe()` is async (returns an
    // EventEmitter Subscription); we don't read events, we just HOLD it open
    // until `dispose()` closes it after the read. NOTE: focusing the window pops
    // it to the foreground (the wake needs a focus event) — acceptable for a
    // user-asked "look at Discord".
    const subscription = await initial.subscribe()
    try {
      await foregroundWindow(pid)
      await delay(ELECTRON_WAKE_MS)
      const app = await App.byPid(pid, { timeout: APP_LOOKUP_TIMEOUT_MS })
      return { app, dispose: () => closeSubscription(subscription), viaElectronWake: true }
    } catch (wakeError) {
      // A throw anywhere between subscribe() and handing back `dispose` must
      // release the subscription HERE — else the caller never gets the dispose
      // handle and the held UIA listener leaks.
      closeSubscription(subscription)
      throw wakeError
    }
  }
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

/**
 * Read a named app's accessibility tree as an indented role/name/value dump
 * (xa11y's `app.dump`). `query` is matched case-insensitively as a substring of
 * the app name. Native + Qt apps resolve via UIA enumeration; Electron apps
 * (not enumerated, tree off by default) are reached by pid and woken
 * automatically (`resolveAppWithFallback`). Throws an actionable error if the
 * app isn't open.
 */
export async function snapshotApp(query: string, options: SnapshotAppOptions = {}): Promise<string> {
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
    return await withTimeout(dumpApp(resolved.app, maxDepth), SNAPSHOT_TIMEOUT_MS, 'snapshot')
  } finally {
    // Release the Electron-wake subscription (a no-op for enumerated apps).
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
    // Release the Electron-wake subscription (a no-op for enumerated apps).
    resolved.dispose()
  }
}

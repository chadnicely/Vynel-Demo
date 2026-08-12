// Window-identity primitives for ACCESS ENFORCEMENT — "which app actually
// receives this input?" answered from the live window list (node-screenshots,
// via the shared lazy loader in `screenshot-adapter.ts`): the focused window
// for keystrokes, the topmost window under a point for mouse actions, and the
// name roster app resolution works from. Split from the screenshot adapter
// because these serve enforcement and identity, not capture.

import { loadNodeScreenshots } from './screenshot-adapter.js'
import { isWindowHostProcess, readWindowIdentity } from './window-host-processes.js'

/**
 * The app name of the window that currently has keyboard focus — the
 * enforcement target for focus-directed input (type / key-press), which lands
 * wherever the OS focus is regardless of any coordinates. Null when nothing
 * reports focus (fail closed at the caller).
 */
export function findFocusedWindowAppName(): string | null {
  const { Window } = loadNodeScreenshots()
  const focused = Window.all().find((native) => {
    try {
      return native.isFocused() && !native.isMinimized()
    } catch {
      return false
    }
  })
  return focused !== undefined ? readWindowIdentity(focused) : null
}

/** A window's rectangle + stacking order, read into plain data for the pure
 *  hit-test below. */
export interface WindowHitCandidate {
  appName: string
  isMinimized: boolean
  x: number
  y: number
  width: number
  height: number
  z: number
}

/**
 * The topmost candidate containing the point — HIGHER z wins (verified
 * empirically against node-screenshots 0.2.8 on Windows: the foreground-most
 * window carries the largest z). Sorted explicitly rather than trusting
 * `Window.all()`'s enumeration order — this is an enforcement primitive.
 * Pure + exported for tests.
 */
export function pickTopmostWindowAt(
  candidates: WindowHitCandidate[],
  x: number,
  y: number,
): WindowHitCandidate | null {
  const hits = candidates
    .filter(
      (candidate) =>
        !candidate.isMinimized &&
        x >= candidate.x &&
        x < candidate.x + candidate.width &&
        y >= candidate.y &&
        y < candidate.y + candidate.height,
    )
    .sort((a, b) => b.z - a.z)
  return hits[0] ?? null
}

/**
 * The app name of the topmost window under an ABSOLUTE screen point — the
 * enforcement target for absolute-coordinate mouse actions. Null when no
 * window contains the point (fail closed at the caller — clicking into the
 * void is not an authorized target).
 */
export function findWindowAppNameAtPoint(x: number, y: number): string | null {
  const { Window } = loadNodeScreenshots()
  const candidates: WindowHitCandidate[] = Window.all().map((native) => ({
    // The identity, not the raw process name — a click landing on Calculator
    // must enforce and report as Calculator, not as the host it shares with
    // every other packaged app. An unnameable window keeps '' and so can never
    // match an authorization.
    appName: readWindowIdentity(native) ?? '',
    isMinimized: Boolean(native.isMinimized()),
    x: Number(native.x()),
    y: Number(native.y()),
    width: Number(native.width()),
    height: Number(native.height()),
    z: Number(native.z()),
  }))
  // '' is the unnameable marker, not a name — hand back null so the caller
  // fails closed the same way it does when no window contains the point.
  const hit = pickTopmostWindowAt(candidates, x, y)?.appName ?? ''
  return hit.length > 0 ? hit : null
}

/**
 * Distinct app names across the current windows (minimized included — a
 * minimized app is still identifiable and targetable). One of the two identity
 * sources app resolution works from: xa11y's `App.list()`
 * misses the Electron/Chromium class (tree off until woken), and a roster that
 * can't NAME those apps would leave the exact screenshot/wake paths built for
 * them unaddressable.
 */
export function listWindowAppNames(): string[] {
  const { Window } = loadNodeScreenshots()
  const names = new Set<string>()
  for (const native of Window.all()) {
    // Packaged apps enter here as one repeated "Application Frame Host"; their
    // titles are what make Calculator and Settings distinct rows. Without this
    // the roster cannot name them, which is why launch_app reported
    // started-no-window for a Store app that had plainly opened.
    const identity = readWindowIdentity(native)
    if (identity !== null) names.add(identity)
  }
  return [...names]
}

/**
 * The identities of every HOSTED window — the packaged (Store) apps currently
 * open. Used to tell "the accessibility engine cannot reach this one because a
 * sibling holds the process" apart from "this app is not open", which are the
 * same failure as far as xa11y is concerned and need opposite advice.
 */
export function listHostedWindowNames(): string[] {
  const { Window } = loadNodeScreenshots()
  const names: string[] = []
  for (const native of Window.all()) {
    try {
      if (!isWindowHostProcess(String(native.appName() ?? ''))) continue
      const identity = readWindowIdentity(native)
      if (identity !== null) names.push(identity)
    } catch {
      // A shape surprise on one window must not blind the whole lookup.
    }
  }
  return names
}

/** One window as the identity rule needs to see it. */
export type PidWindowCandidate = { pid: number; appName: string; title?: string }

/**
 * Which app a pid means — pure, so the rule can be tested without the native
 * binary (the same reason `pickTopmostWindowAt` is extracted).
 *
 * A HOSTED pid is genuinely ambiguous once it owns more than one NAMED window:
 * Calculator and Settings both live on pid 8828, and nothing in the pid says
 * which one the caller meant, so answering would name the wrong app.
 *
 * One named window plus untitled siblings still answers — deliberately. An
 * untitled hosted window cannot be named at all, so refusing everything would
 * make the common single-Store-app case unusable to protect a window no caller
 * can address by name anyway.
 */
export function pickIdentityForPid(candidates: PidWindowCandidate[], pid: number): string | null {
  const identities = new Set<string>()
  let hosted = false
  for (const candidate of candidates) {
    if (candidate.pid !== pid) continue
    if (isWindowHostProcess(candidate.appName)) hosted = true
    const identity = readWindowIdentity({
      appName: () => candidate.appName,
      title: () => candidate.title,
    })
    if (identity !== null) identities.add(identity)
  }
  if (hosted && identities.size !== 1) return null
  const [first] = identities
  return first ?? null
}

/**
 * The APP name owning a process — the canonical identity the plan envelope and
 * the activity record are keyed on. Null when no window maps to that pid.
 *
 * WHY this exists: the two desktop sources name things differently. xa11y's
 * `App.name` is the WINDOW TITLE ("Vynel – Google Chrome", and a different
 * string the moment the user switches tabs); the window source reports the
 * stable app ("Google Chrome"). Keying a grant on a title made it die on the
 * next tab switch and made a grant taken through the accessibility door fail
 * on the screenshot door. The pid is what both sources agree on, so identity
 * normally resolves THROUGH it.
 *
 * The exception, and the reason this returns null more often than it used to:
 * a pid is NOT a unique app for packaged apps. Calculator and Settings both
 * live on pid 8828 inside one `ApplicationFrameHost` — so for a hosted pid the
 * "one thing both sources agree on" agrees on the wrong thing. When such a pid
 * owns more than one window there is no answer, and null is the honest one.
 *
 * And note what that costs, because it partly reverses the paragraph above:
 * for a hosted window the identity IS the title, the very thing this function
 * exists to avoid keying on. That is accepted rather than overlooked. A
 * packaged app's title is its name ("Calculator", "Settings"), not the volatile
 * document string a browser tab produces — but it is still app-controlled, so a
 * hosted window titled "Google Chrome" would identify as Chrome. There is no
 * better identity source for these windows in `node-screenshots`, and the
 * alternative — one shared host name — was measurably worse: it made every
 * packaged app the SAME app. A narrower wrong beats a categorical one.
 */
export function findAppNameByPid(pid: number): string | null {
  const { Window } = loadNodeScreenshots()
  const candidates: PidWindowCandidate[] = []
  for (const native of Window.all()) {
    try {
      candidates.push({
        pid: Number(native.pid()),
        appName: String(native.appName() ?? ''),
        title: String(native.title() ?? ''),
      })
    } catch {
      // A shape surprise on one window must not blind the whole lookup.
    }
  }
  return pickIdentityForPid(candidates, pid)
}

/** The lookup `resolveAppIdentity` performs — injectable for tests. */
export type AppNameByPidLookup = (pid: number) => string | null

/**
 * Canonical identity for an app reached through the accessibility tree:
 * the pid's real app name, falling back to the name the caller had when the
 * pid can't be mapped (a pid-less app, or a window the capture source can't
 * see).
 *
 * **`fallbackName` must be a name that was OBSERVED, never one that was
 * REQUESTED.** xa11y's resolved `App.name` and a window title qualify; the
 * model's `app` argument does not. The distinction is not academic: packaged
 * apps share one pid, so the lookup returns null for an ambiguous host pid and
 * the fallback becomes the answer. Pass the query there and "move Calculator"
 * happily names a Settings window Calculator — which then authorizes against
 * the wrong app and records the wrong one. `set-window-bounds-tool.ts` passes
 * `''` for exactly this reason, and takes the empty result as "cannot identify,
 * do nothing". A caller with no observed name should do the same.
 */
export function resolveAppIdentity(
  pid: number | null,
  fallbackName: string,
  lookup: AppNameByPidLookup = findAppNameByPid,
): string {
  const resolved = pid === null ? fallbackName : (lookup(pid) ?? fallbackName)
  // A host process is never an identity, by whichever route it arrived. This is
  // the backstop that makes the whole rule hold: even a stale grant keyed on
  // "Application Frame Host" — one exists in the dev database — becomes
  // unreachable, because nothing can resolve to that name any more. '' is the
  // unidentified marker, which `assertDesktopAccess` already refuses with
  // "the target app could not be identified".
  return isWindowHostProcess(resolved) ? '' : resolved
}

// Starting an app that isn't running, then WAITING for its window — the step
// that turns "open Chrome and search YouTube" from a dead end into a task,
// because every other primitive in this package addresses a live window.
//
// One launch mechanism for both app kinds: `shell:AppsFolder\<AppID>` is the
// shell's own Apps-folder addressing, so a packaged (UWP) AUMID and a Win32
// Start-menu id start the same way — no exe-path guessing, and the id came
// from the roster the user's own Start menu shows.
//
// The AppID is never interpolated into a command string: it rides an ENVIRONMENT
// VARIABLE, so a hostile-looking id can't become another PowerShell statement.
// It is also validated first — the only ids we launch are ones that came back
// from `Get-StartApps`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LAUNCH_TIMEOUT_MS = 15_000
const WINDOW_WAIT_TIMEOUT_MS = 20_000
const WINDOW_POLL_INTERVAL_MS = 400

/** Whether an AppID is safe to hand to the shell. Deliberately strict: real
 *  `Get-StartApps` ids are AUMIDs and shell-folder paths, so quotes, newlines
 *  and shell metacharacters have no legitimate place in one. Belt-and-braces
 *  with env-var passing, which already keeps the id out of the command text —
 *  this stays because the id still reaches the SHELL, which has its own
 *  opinions about what a path means. */
export function isLaunchableAppId(appId: string): boolean {
  if (appId.length === 0 || appId.length > 512) return false
  return !/["'`$;&|<>\r\n]/.test(appId)
}

export type LaunchAppDeps = {
  /** Injectable for tests — production spawns PowerShell. */
  startApp?: (appId: string) => Promise<void>
  /** The live window roster, for the appeared-yet check. */
  listWindowAppNames?: () => string[]
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** The window roster, or an empty one. A window-source hiccup is not a launch
 *  failure — the caller's deadline decides. */
function readWindowNames(listNames: () => string[]): string[] {
  try {
    return listNames()
  } catch {
    return []
  }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** The env var carrying the AppID into PowerShell. Named, not inline, because
 *  the invariant that binds this file together is "the command dereferences
 *  exactly what the invocation supplies" — and its test asserts that by name. */
const APP_ID_VARIABLE = 'VYNEL_LAUNCH_APP_ID'

/**
 * The exact PowerShell invocation, separated from the spawn so it can be
 * asserted without starting anything.
 *
 * WHY an env var and not `-Args`: `-Args` is only honoured by `-File`. Under
 * `-Command` it is silently ignored, `$args` stays empty, and the path collapses
 * to bare `shell:AppsFolder\` — which is a real folder, so `Start-Process`
 * SUCCEEDS and opens the Applications window instead of the app. Every launch
 * reported success and nothing ever started. An env var has no such trapdoor,
 * and keeps the id out of the command text exactly as an argument array would.
 */
export function buildLaunchInvocation(appId: string): {
  args: string[]
  env: Record<string, string>
} {
  return {
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process -FilePath ("shell:AppsFolder\\" + $env:${APP_ID_VARIABLE})`,
    ],
    env: { [APP_ID_VARIABLE]: appId },
  }
}

async function startViaShell(appId: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Launching apps is supported on Windows only.')
  }
  const invocation = buildLaunchInvocation(appId)
  await execFileAsync('powershell', invocation.args, {
    windowsHide: true,
    timeout: LAUNCH_TIMEOUT_MS,
    env: { ...process.env, ...invocation.env },
  })
}

/**
 * Pick the window that IS the app, from the names currently on screen.
 *
 * Ranked, not first-hit — the same lesson `selectWindowedPid` learned: an
 * unranked substring match takes whichever window the enumeration happened to
 * list first. Kafi hit it live (2026-08-12): a leftover "Docker Desktop
 * Launcher" error dialog was still on screen, "Docker Desktop Launcher"
 * contains "Docker Desktop", so `launch_app` reported the DIALOG as the app and
 * the model spent the rest of the turn screenshotting and requesting access to
 * an error box.
 *
 * The tiers, most trustworthy first:
 *   1. An exact name — no ambiguity to resolve.
 *   2. The window reports a SHORTER name than asked for ("Firefox Developer
 *      Edition" opening as "Firefox", "Google Chrome" as "chrome.exe"). This is
 *      the real app under a plainer name.
 *   3. The window name EXTENDS the one asked for — the suspicious direction,
 *      because that is what "<App> Launcher", "<App> Helper" and "<App> Setup"
 *      all look like. Shortest wins, being the closest to what was asked.
 *
 * Pure, for tests.
 */
export function selectAppearedWindow(names: string[], requestedName: string): string | null {
  const needle = requestedName.trim().toLowerCase()
  if (needle.length === 0) return null
  const simplify = (name: string): string => name.trim().toLowerCase().replace(/\.exe$/, '')
  const tierOf = (name: string): number => {
    const candidate = simplify(name)
    if (candidate === needle) return 1
    if (needle.includes(candidate)) return 2
    return candidate.includes(needle) ? 3 : Number.POSITIVE_INFINITY
  }
  const ranked = names
    .map((name) => ({ name, tier: tierOf(name) }))
    .filter((entry) => Number.isFinite(entry.tier))
    .sort((a, b) => a.tier - b.tier || a.name.length - b.name.length)
  return ranked[0]?.name ?? null
}

export type LaunchAppResult =
  /** A window carrying this name appeared — the app is ready to target. */
  | { kind: 'launched'; appName: string }
  /** A window was ALREADY on screen, so nothing was started. Launching an app
   *  that already has a window is not harmless: Docker Desktop answers a second
   *  activation with an "acquiring launcher lock" error DIALOG, which then sits
   *  on screen looking like the app (Kafi, live 2026-08-12). */
  | { kind: 'already-open'; appName: string }
  /** The launch command ran, but no matching window appeared before the
   *  deadline (a slow splash, an app that reuses an existing window, or one
   *  whose window name differs from its Start-menu name). */
  | { kind: 'started-no-window'; appName: string }

/**
 * Start an installed app and wait until a window whose app name matches shows
 * up. Waiting is the point: without it the model would immediately snapshot a
 * window that doesn't exist yet and conclude the app failed to open.
 *
 * Matching is a case-insensitive substring both ways — the Start-menu name
 * ("Google Chrome") and the window's app name ("chrome.exe", "Google Chrome")
 * agree often but not always. This match only decides WHETHER TO KEEP WAITING;
 * it never grants anything, so it can be forgiving where the grant/plan check
 * (exact normalized key, enforced later on every act) must not be.
 */
export async function launchApp(
  app: { name: string; appId: string },
  deps: LaunchAppDeps = {},
): Promise<LaunchAppResult> {
  if (!isLaunchableAppId(app.appId)) {
    throw new Error(
      `Refusing to launch "${app.name}": its app id is not in the expected form. ` +
        'Use list_installed_apps and pass an id from that list.',
    )
  }
  const start = deps.startApp ?? startViaShell
  const listNames = deps.listWindowAppNames ?? (() => [])
  const sleep = deps.sleep ?? realSleep
  const now = deps.now ?? Date.now

  // Look BEFORE starting. A tray-hidden app has no window, so recovery still
  // launches; an app already showing one gets left alone, because a second
  // activation is what produces Docker's launcher-lock error dialog.
  const openNow = selectAppearedWindow(readWindowNames(listNames), app.name)
  if (openNow !== null) return { kind: 'already-open', appName: openNow }

  await start(app.appId)

  const deadline = now() + WINDOW_WAIT_TIMEOUT_MS
  while (now() < deadline) {
    await sleep(WINDOW_POLL_INTERVAL_MS)
    const appeared = selectAppearedWindow(readWindowNames(listNames), app.name)
    if (appeared !== null) return { kind: 'launched', appName: appeared }
  }
  return { kind: 'started-no-window', appName: app.name }
}

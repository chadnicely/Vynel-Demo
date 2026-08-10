// Starting an app that isn't running, then WAITING for its window — the step
// that turns "open Chrome and search YouTube" from a dead end into a task,
// because every other primitive in this package addresses a live window.
//
// One launch mechanism for both app kinds: `shell:AppsFolder\<AppID>` is the
// shell's own Apps-folder addressing, so a packaged (UWP) AUMID and a Win32
// Start-menu id start the same way — no exe-path guessing, and the id came
// from the roster the user's own Start menu shows.
//
// The AppID is never interpolated into a command string: it goes through
// `execFile`'s ARGUMENT array, so a hostile-looking id can't become another
// PowerShell statement. It is also validated first — the only ids we launch are
// ones that came back from `Get-StartApps`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LAUNCH_TIMEOUT_MS = 15_000
const WINDOW_WAIT_TIMEOUT_MS = 20_000
const WINDOW_POLL_INTERVAL_MS = 400

/** Whether an AppID is safe to hand to the shell. Deliberately strict: real
 *  `Get-StartApps` ids are AUMIDs and shell-folder paths, so quotes, newlines
 *  and shell metacharacters have no legitimate place in one. Belt-and-braces
 *  with argument-array passing — an id also reaches PowerShell's own parser. */
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

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

async function startViaShell(appId: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Launching apps is supported on Windows only.')
  }
  // `-EncodedCommand`-free by design: the id rides an argument, never the
  // command text. `-Args` keeps PowerShell's own quoting out of it too.
  await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Start-Process -FilePath ("shell:AppsFolder\\" + $args[0])',
      '-Args',
      appId,
    ],
    { windowsHide: true, timeout: LAUNCH_TIMEOUT_MS },
  )
}

export type LaunchAppResult =
  /** A window carrying this name appeared — the app is ready to target. */
  | { kind: 'launched'; appName: string }
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

  await start(app.appId)

  const deadline = now() + WINDOW_WAIT_TIMEOUT_MS
  const needle = app.name.toLowerCase()
  while (now() < deadline) {
    await sleep(WINDOW_POLL_INTERVAL_MS)
    let names: string[] = []
    try {
      names = listNames()
    } catch {
      // A window-source hiccup mid-wait is not a launch failure — keep polling
      // until the deadline decides.
      names = []
    }
    const appeared = names.find((name) => {
      const candidate = name.toLowerCase()
      return candidate.includes(needle) || needle.includes(candidate.replace(/\.exe$/, ''))
    })
    if (appeared !== undefined) return { kind: 'launched', appName: appeared }
  }
  return { kind: 'started-no-window', appName: app.name }
}

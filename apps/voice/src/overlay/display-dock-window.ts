import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { Logger } from 'pino'

// Launch/focus the display dock — the Display's mini window. Two ways in, and
// the wake path picks between them on `hasApp`:
//
//   * `openApp()` — the Tauri desktop shell (apps/desktop), spawned ARGLESS.
//     One process, both windows: `create_windows` builds the main window AND
//     the transparent always-on-top `display-dock` webview, so this single
//     launch is the dock's launch too. A second argless launch routes into the
//     resident shell's single-instance handler and exits at once, which is the
//     HEALTHY case — it surfaced the window that was already there.
//   * `openBrowser()` — a chromeless Chrome/Edge app-window on local-web's
//     /display-dock route, for a machine with no desktop app (and for an exe
//     that is present but silently broken: a stale build panicking at boot).
//
// Nothing here judges a launch: the exe is a compiled artifact that can die
// without a trace, but the honest verdict is "did a dock ever CONNECT", which
// only the overlay channel knows. `wake-handoff` owns that watchdog and calls
// `openBrowser()` when it fires — spawning both up front raced the shell's
// single-instance handler and left a stray browser window on every cold wake.
//
// All best-effort native shell calls: if they fail the wake stays pending on
// the overlay channel and the handoff watchdog returns the daemon to sleep.

// AppActivate matches by window title — keep in sync with DisplayDockView.vue.
const WINDOW_TITLE = 'Vynel Display'
const WINDOW_SIZE = '420,560'

export interface DisplayDockCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** Pure: the platform-specific launch invocation (tested; spawn is not). */
export function buildDisplayDockLaunchCommand(
  browser: 'chrome' | 'msedge',
  url: string,
  platform: NodeJS.Platform,
): DisplayDockCommand {
  const appArgs = [`--app=${url}`, `--window-size=${WINDOW_SIZE}`]
  if (platform === 'win32') {
    // `start` resolves chrome/msedge via the App Paths registry — they are
    // usually NOT on PATH on Windows.
    return { command: 'cmd', args: ['/c', 'start', '', browser, ...appArgs] }
  }
  if (platform === 'darwin') {
    const appName = browser === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'
    return { command: 'open', args: ['-na', appName, '--args', ...appArgs] }
  }
  const binary = browser === 'msedge' ? 'microsoft-edge' : 'google-chrome'
  return { command: binary, args: appArgs }
}

/** The one detached child the seam exposes — enough to log a shell call that
 *  never started. A launch that starts and then dies is NOT diagnosed here:
 *  the honest signal is a dock failing to connect, which `wake-handoff` owns. */
export interface SpawnedCommand {
  onError(listener: (error: Error) => void): void
}

/** Injected so the launch/fallback flow is unit-testable without real spawns. */
export type CommandSpawner = (command: string, args: readonly string[]) => SpawnedCommand

const spawnDetached: CommandSpawner = (command, args) => {
  const child = spawn(command, [...args], { detached: true, stdio: 'ignore' })
  child.unref()
  return { onError: (listener) => child.on('error', listener) }
}

export interface DisplayDockWindow {
  /** Is the desktop shell installed on this machine? False = the browser
   *  window is the only dock there is, so the wake path opens it straight
   *  away instead of waiting on a launch that cannot happen. */
  readonly hasApp: boolean
  /** Bring an already-open dock window to the front (Windows only; no-op
   *  elsewhere). */
  focus(): void
  /** Launch the desktop shell — the exe, ARGLESS. This opens the dock TOO: one
   *  process builds the main window and the `display-dock` webview together
   *  (apps/desktop windows.rs `create_windows`). A second launch routes into
   *  the resident shell's single-instance handler and exits at once, which
   *  surfaces the window that is already there. No fallback here: whether a
   *  dock actually came up is answered by a dock CONNECTING, which only the
   *  overlay channel can see (`wake-handoff`). */
  openApp(): void
  /** The fallback dock: a chromeless browser window on the /display-dock
   *  route. For a machine with no desktop app, and for an app that never
   *  connected within the handoff's connect window. */
  openBrowser(): void
}

export function createDisplayDockWindow(
  config: {
    readonly browser: 'chrome' | 'msedge'
    readonly url: string
    /** Path to the Tauri overlay executable (preferred over the browser). */
    readonly appPath?: string
  },
  logger: Logger,
  spawnCommand: CommandSpawner = spawnDetached,
): DisplayDockWindow {
  const run = (invocation: DisplayDockCommand, action: string): void => {
    spawnCommand(invocation.command, invocation.args).onError((error) => {
      logger.warn({ action, error: error.message }, 'display dock shell call failed')
    })
  }

  return {
    get hasApp(): boolean {
      return config.appPath !== undefined && existsSync(config.appPath)
    },
    openApp(): void {
      if (config.appPath === undefined || !existsSync(config.appPath)) {
        logger.debug({ app: config.appPath }, 'no desktop app on this machine — the browser window is the dock')
        return
      }
      logger.info({ app: config.appPath }, 'launching the desktop shell for a wake — app window and dock together')
      run({ command: config.appPath, args: [] }, 'open-app')
    },
    openBrowser(): void {
      logger.info({ url: config.url, browser: config.browser }, 'opening the display dock browser window')
      run(buildDisplayDockLaunchCommand(config.browser, config.url, process.platform), 'open-browser')
    },
    focus(): void {
      if (process.platform !== 'win32') return
      run(
        {
          command: 'powershell',
          args: [
            '-NoProfile',
            '-Command',
            `(New-Object -ComObject WScript.Shell).AppActivate('${WINDOW_TITLE}')`,
          ],
        },
        'focus',
      )
    },
  }
}

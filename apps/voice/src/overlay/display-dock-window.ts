import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { Logger } from 'pino'

// Launch/focus the display dock — the Display's mini window. Preferred: the
// Tauri overlay app (transparent always-on-top, apps/desktop) when its exe exists;
// fallback: a chromeless Chrome/Edge app-window on local-web's /display-dock route.
// The daemon opens one on wake when no window is connected, and pulls an
// existing one to the front otherwise. `openApp()` is the third call: the same
// exe with NO args, which brings the full desktop app forward beside the dock.
// All best-effort native shell calls: if
// they fail the wake stays pending on the overlay channel and the handoff
// watchdog returns the daemon to sleep.
//
// The overlay exe is a compiled artifact that can be silently broken (a stale
// build panicking at boot, a config drift) — existsSync alone proved a wake
// could die without a trace. An exe that exits within APP_EARLY_EXIT_MS never
// showed a window, so open() falls back to the browser and the pending wake
// still gets answered.

// AppActivate matches by window title — keep in sync with DisplayDockView.vue.
const WINDOW_TITLE = 'Vynel Display'
const WINDOW_SIZE = '420,560'
// An exe gone this fast either crashed at boot or single-instance-routed into
// a resident shell that is NOT connected to the daemon (a healthy resident
// would have made this wake a focus(), not an open()). Both mean no window.
const APP_EARLY_EXIT_MS = 3000

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

/** The one detached child the seam exposes — enough to observe a launch dying. */
export interface SpawnedCommand {
  onError(listener: (error: Error) => void): void
  onExit(listener: (code: number | null) => void): void
}

/** Injected so the open()/fallback flow is unit-testable without real spawns. */
export type CommandSpawner = (command: string, args: readonly string[]) => SpawnedCommand

const spawnDetached: CommandSpawner = (command, args) => {
  const child = spawn(command, [...args], { detached: true, stdio: 'ignore' })
  child.unref()
  return {
    onError: (listener) => child.on('error', listener),
    onExit: (listener) => child.on('exit', (code) => listener(code)),
  }
}

export interface DisplayDockWindow {
  /** Open a new dock window (returns immediately; a dying launch is watched
   *  and falls back to the browser). */
  open(): void
  /** Bring an already-open window to the front (Windows only; no-op elsewhere). */
  focus(): void
  /** Launch the desktop app ITSELF — the same exe, ARGLESS. A first launch
   *  opens the main window; a second routes into the resident shell's
   *  single-instance handler, which surfaces the window that is already there
   *  (apps/desktop src/main.rs). No browser fallback: this asks for the app, and
   *  a machine without it simply has no app to bring forward. */
  openApp(): void
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

  const openBrowserWindow = (): void => {
    logger.info({ url: config.url, browser: config.browser }, 'opening the display dock browser window')
    run(buildDisplayDockLaunchCommand(config.browser, config.url, process.platform), 'open')
  }

  return {
    open(): void {
      if (config.appPath === undefined || !existsSync(config.appPath)) {
        openBrowserWindow()
        return
      }
      logger.info({ app: config.appPath }, 'opening the display dock overlay app')
      // A wake opens ONLY the overlay — --dock-only tells the shell to
      // skip its main app window (apps/desktop src/main.rs).
      const child = spawnCommand(config.appPath, ['--dock-only'])
      const startedAt = Date.now()
      // error + exit can both fire for one failed launch — fall back once.
      let fellBack = false
      const fallBack = (reason: string): void => {
        if (fellBack) return
        fellBack = true
        logger.warn(
          { app: config.appPath, reason },
          'the display dock overlay app never came up — opening the browser window instead; rebuild the overlay with `pnpm dev:desktop`',
        )
        openBrowserWindow()
      }
      child.onError((error) => fallBack(error.message))
      child.onExit((code) => {
        // code 0 usually means single-instance routed into a resident shell
        // (which open() implies is NOT connected); non-zero means a crash.
        if (Date.now() - startedAt <= APP_EARLY_EXIT_MS) fallBack(`exited immediately (code ${code})`)
      })
    },
    openApp(): void {
      if (config.appPath === undefined || !existsSync(config.appPath)) {
        logger.debug({ app: config.appPath }, 'no desktop app on this machine — the wake stays in the dock')
        return
      }
      logger.info({ app: config.appPath }, 'bringing the desktop app forward for a wake')
      // Deliberately NOT open()'s early-exit watchdog: here a fast exit is the
      // HEALTHY case — single-instance routed the launch into the resident
      // shell, which surfaced its own window.
      run({ command: config.appPath, args: [] }, 'open-app')
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

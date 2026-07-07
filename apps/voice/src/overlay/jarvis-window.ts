import { spawn } from 'node:child_process'
import type { Logger } from 'pino'

// Launch/focus the floating Jarvis window — a small chromeless Chrome/Edge
// app-window on local-web's /jarvis route. The daemon opens it on wake when no
// window is connected, and pulls an existing one to the front otherwise. Both
// are best-effort native shell calls: if they fail the wake stays pending on
// the overlay channel and the handoff watchdog returns the daemon to sleep.

// AppActivate matches by window title — keep in sync with JarvisView.vue.
const WINDOW_TITLE = 'Vynel Jarvis'
const WINDOW_SIZE = '420,560'

export interface JarvisWindowCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** Pure: the platform-specific launch invocation (tested; spawn is not). */
export function buildJarvisLaunchCommand(
  browser: 'chrome' | 'msedge',
  url: string,
  platform: NodeJS.Platform,
): JarvisWindowCommand {
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

export interface JarvisWindow {
  /** Open a new Jarvis window (fire-and-forget). */
  open(): void
  /** Bring an already-open window to the front (Windows only; no-op elsewhere). */
  focus(): void
}

export function createJarvisWindow(
  config: { readonly browser: 'chrome' | 'msedge'; readonly url: string },
  logger: Logger,
): JarvisWindow {
  const run = (invocation: JarvisWindowCommand, action: string): void => {
    const child = spawn(invocation.command, [...invocation.args], {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', (error) => {
      logger.warn({ action, error: error.message }, 'jarvis window shell call failed')
    })
    child.unref()
  }

  return {
    open(): void {
      logger.info({ url: config.url, browser: config.browser }, 'opening jarvis window')
      run(buildJarvisLaunchCommand(config.browser, config.url, process.platform), 'open')
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

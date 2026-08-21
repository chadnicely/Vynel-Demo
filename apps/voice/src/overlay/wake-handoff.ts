import type { Logger } from 'pino'
import type { WakeHandoff } from '../loop/voice-session-types.js'
import type { DisplayDockWindow } from './display-dock-window.js'
import type { OverlayChannel } from './overlay-channel.js'

// What a wake DOES to the user's screen, in one place — the driver only says
// "a wake landed", and everything below is the desk it lands on.
//
// With the dock window feature on, one wake moves three things:
//   1. the wake itself is published (held on the channel until a capable client
//      confirms it — that is what survives the dock window's launch time);
//   2. the desktop shell is launched ARGLESS, which surfaces the main window
//      AND builds the `display-dock` webview in the same process, and every app
//      surface is told to show the Display — the room mirrors the conversation
//      the dock is holding;
//   3. a dock that is ALREADY connected is simply pulled to the front instead.
//
// ONE launch, deliberately. The argless launch already carries the dock
// (apps/desktop `create_windows`), so also spawning `--dock-only` made a second
// process that lost the single-instance race, exited 0, and read as a dead
// launch — every cold wake ended with a stray browser window beside the real
// dock. The app leg still runs on EVERY wake, before the already-connected
// shortcut returns, because the dock may be resident while the app is not.
//
// WHETHER a dock came up is answered by one thing only: a dock CONNECTING.
// So the connect watchdog owns the whole recovery ladder — first the browser
// window (a machine with no desktop app skips straight to it), then, if that
// does not connect either, the handoff is abandoned and the daemon resumes
// wake-listening. A failed launch must not leave it deaf. The cost is stated
// plainly: the exe gets one connect window and the browser it opened gets its
// own, so a wake into a broken desk is deaf for at most twice
// `connectTimeoutMs`. Abandoning at the first fire instead would be worse —
// `endHandoff` publishes `idle`, which NULLS the pending wake, so the browser
// window would open onto a conversation nobody could hand it.

export interface WakeHandoffOptions {
  readonly overlay: Pick<OverlayChannel, 'publishWake' | 'publishShowDisplay' | 'hasWakeTarget'>
  readonly dockWindow: DisplayDockWindow
  /** VYNEL_VOICE_DOCK_WINDOW=1 — the dock owns wake sessions. */
  readonly dockEnabled: boolean
  readonly logger: Logger
  /** How long a launched dock has to connect before the handoff is abandoned. */
  readonly connectTimeoutMs: number
  /** Give the daemon its microphone back (the driver's `endHandoff`). */
  readonly abandonHandoff: () => void
  /** Test seam for the connect watchdog's clock. */
  readonly setTimer?: (callback: () => void, delayMs: number) => { cancel: () => void }
}

export interface WakeHandoffPolicy {
  readonly handoff: WakeHandoff
  /** Clear the pending connect watchdog (shutdown). */
  stop(): void
}

export function createWakeHandoff(options: WakeHandoffOptions): WakeHandoffPolicy {
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number) => {
      const handle = setTimeout(callback, delayMs)
      return { cancel: () => clearTimeout(handle) }
    })
  let connectWatchdog: { cancel: () => void } | null = null
  /** One browser window per wake — the ladder's middle rung, not a retry. */
  let browserOpened = false

  const openBrowserDock = (): void => {
    browserOpened = true
    options.dockWindow.openBrowser()
  }

  const armConnectWatchdog = (): void => {
    connectWatchdog?.cancel()
    connectWatchdog = setTimer(() => {
      connectWatchdog = null
      if (options.overlay.hasWakeTarget) return
      if (!browserOpened) {
        options.logger.warn(
          'the display dock overlay never connected — opening the browser window instead; rebuild the overlay with `pnpm dev:desktop`',
        )
        openBrowserDock()
        armConnectWatchdog()
        return
      }
      options.logger.warn('the display dock never connected — resuming wake listening')
      options.abandonHandoff()
    }, options.connectTimeoutMs)
  }

  return {
    handoff: {
      // With the dock on, EVERY wake hands off — the window is opened for it.
      // Without it, only a connected client that declared it can run a session.
      shouldHandOff: () => options.dockEnabled || options.overlay.hasWakeTarget,
      publishWake: (command) => {
        options.overlay.publishWake(command)
        if (!options.dockEnabled) return
        options.dockWindow.openApp()
        options.overlay.publishShowDisplay()
        // Already there: nothing to launch, so nothing to wait on.
        if (options.overlay.hasWakeTarget) {
          options.dockWindow.focus()
          return
        }
        // The argless launch above IS the dock's launch when the app exists;
        // the pending wake replays the moment it connects.
        browserOpened = false
        if (!options.dockWindow.hasApp) openBrowserDock()
        armConnectWatchdog()
      },
    },
    stop(): void {
      connectWatchdog?.cancel()
      connectWatchdog = null
    },
  }
}

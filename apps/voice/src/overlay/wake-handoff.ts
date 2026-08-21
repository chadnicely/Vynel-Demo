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
//   2. the DOCK opens (or is pulled to the front) to run the conversation;
//   3. the desktop APP is launched argless, so its single-instance handler
//      surfaces the main window, and every app surface is told to show the
//      Display — the room mirrors the conversation the dock is holding.
//
// Steps 2 and 3 are independent: the dock may already be resident (focus, no
// launch) while the app is not, so the app leg runs on EVERY wake, before the
// dock's own already-connected shortcut returns.
//
// If the dock never connects, the handoff is abandoned and the daemon resumes
// wake-listening — a failed launch must not leave it deaf.

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

  const armConnectWatchdog = (): void => {
    connectWatchdog?.cancel()
    connectWatchdog = setTimer(() => {
      connectWatchdog = null
      if (options.overlay.hasWakeTarget) return
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
        if (options.overlay.hasWakeTarget) {
          options.dockWindow.focus()
          return
        }
        options.dockWindow.open()
        armConnectWatchdog()
      },
    },
    stop(): void {
      connectWatchdog?.cancel()
      connectWatchdog = null
    },
  }
}

import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { createWakeHandoff } from './wake-handoff.js'
import type { DisplayDockWindow } from './display-dock-window.js'

// What a wake DOES to the screen — the part that used to be inline in main.ts
// and therefore unpinnable. The native shell calls are recorded rather than
// made; the channel is a stub that only has to answer "is a wake target here".

const logger = pino({ level: 'silent' })

function createRecordingDockWindow(hasApp: boolean): DisplayDockWindow & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    hasApp,
    focus: () => calls.push('focus'),
    openApp: () => calls.push('openApp'),
    openBrowser: () => calls.push('openBrowser'),
  }
}

function buildHandoff(input: {
  dockEnabled: boolean
  hasWakeTarget: boolean
  /** Default: the machine has the desktop shell — the cold-start shape. */
  hasApp?: boolean
}) {
  const published: string[] = []
  let showDisplayCount = 0
  let abandoned = 0
  let hasWakeTarget = input.hasWakeTarget
  const timers: Array<() => void> = []
  const dockWindow = createRecordingDockWindow(input.hasApp ?? true)
  const policy = createWakeHandoff({
    overlay: {
      publishWake: (command) => published.push(command),
      publishShowDisplay: () => {
        showDisplayCount += 1
      },
      get hasWakeTarget() {
        return hasWakeTarget
      },
    },
    dockWindow,
    dockEnabled: input.dockEnabled,
    logger,
    connectTimeoutMs: 10_000,
    abandonHandoff: () => {
      abandoned += 1
    },
    setTimer: (callback) => {
      timers.push(callback)
      return { cancel: () => {} }
    },
  })
  return {
    policy,
    dockWindow,
    published,
    timers,
    /** The dock subscribed (or dropped) after the wake was published. */
    hasWakeTarget: (present: boolean) => {
      hasWakeTarget = present
    },
    showDisplayCount: () => showDisplayCount,
    abandoned: () => abandoned,
  }
}

describe('createWakeHandoff with the dock window on', () => {
  // ONE spawn on a cold wake: the argless launch builds the main window and the
  // dock webview in the same process. A second `--dock-only` spawn lost the
  // single-instance race, exited 0, and left a stray browser window behind it.
  it('launches the shell ONCE per wake, argless, and opens no browser', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: false })
    t.policy.handoff.publishWake('what is the time')

    expect(t.published).toEqual(['what is the time'])
    expect(t.dockWindow.calls).toEqual(['openApp'])
    expect(t.showDisplayCount()).toBe(1)
    // The launch is on the clock instead: only a dock that CONNECTS proves it.
    expect(t.timers).toHaveLength(1)

    t.policy.handoff.publishWake('and the date')
    expect(t.dockWindow.calls).toEqual(['openApp', 'openApp'])
    expect(t.showDisplayCount()).toBe(2)
  })

  // The pending wake replays to the dock the moment it subscribes, so a
  // connected target is the whole proof — the watchdog steps aside on its own.
  it('leaves a connected dock alone when the watchdog fires', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: false })
    t.policy.handoff.publishWake('')
    t.hasWakeTarget(true)

    t.timers[0]!()
    expect(t.dockWindow.calls).toEqual(['openApp'])
    expect(t.abandoned()).toBe(0)
  })

  it('still brings the app forward when the dock is already resident', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: true })
    t.policy.handoff.publishWake('')

    // The dock only needs a focus — but the APP may still be closed, so its leg
    // runs before that shortcut returns.
    expect(t.dockWindow.calls).toEqual(['openApp', 'focus'])
    expect(t.showDisplayCount()).toBe(1)
    // Nothing was launched, so nothing is being waited on.
    expect(t.timers).toHaveLength(0)
  })

  // The recovery ladder: the exe gets one connect window, the browser it opens
  // gets its own, and only then does the daemon take its microphone back.
  it('falls back to the browser once, then hands the microphone back', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: false })
    t.policy.handoff.publishWake('')

    t.timers[0]!()
    expect(t.dockWindow.calls).toEqual(['openApp', 'openBrowser'])
    expect(t.abandoned()).toBe(0)

    expect(t.timers).toHaveLength(2)
    t.timers[1]!()
    expect(t.dockWindow.calls).toEqual(['openApp', 'openBrowser'])
    expect(t.abandoned()).toBe(1)
  })

  // No desktop app on this machine: the browser window IS the dock, so there is
  // nothing to wait out before opening it.
  it('opens the browser immediately when the machine has no desktop app', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: false, hasApp: false })
    t.policy.handoff.publishWake('')

    expect(t.dockWindow.calls).toEqual(['openApp', 'openBrowser'])
    expect(t.timers).toHaveLength(1)
    t.timers[0]!()
    expect(t.dockWindow.calls).toEqual(['openApp', 'openBrowser'])
    expect(t.abandoned()).toBe(1)
  })

  it('hands off every wake, connected client or not — the window is opened for it', () => {
    expect(buildHandoff({ dockEnabled: true, hasWakeTarget: false }).policy.handoff.shouldHandOff()).toBe(true)
  })
})

describe('createWakeHandoff with the dock window off', () => {
  it('publishes the wake and touches no window at all', () => {
    const t = buildHandoff({ dockEnabled: false, hasWakeTarget: true })
    t.policy.handoff.publishWake('what is the time')

    expect(t.published).toEqual(['what is the time'])
    expect(t.dockWindow.calls).toEqual([])
    // No dock conversation to mirror — the app has nothing to show.
    expect(t.showDisplayCount()).toBe(0)
  })

  it('hands off only to a client that declared it can run the session', () => {
    expect(buildHandoff({ dockEnabled: false, hasWakeTarget: true }).policy.handoff.shouldHandOff()).toBe(true)
    expect(buildHandoff({ dockEnabled: false, hasWakeTarget: false }).policy.handoff.shouldHandOff()).toBe(false)
  })
})

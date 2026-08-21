import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { createWakeHandoff } from './wake-handoff.js'
import type { DisplayDockWindow } from './display-dock-window.js'

// What a wake DOES to the screen — the part that used to be inline in main.ts
// and therefore unpinnable. The native shell calls are recorded rather than
// made; the channel is a stub that only has to answer "is a wake target here".

const logger = pino({ level: 'silent' })

function createRecordingDockWindow(): DisplayDockWindow & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    open: () => calls.push('open'),
    focus: () => calls.push('focus'),
    openApp: () => calls.push('openApp'),
  }
}

function buildHandoff(input: { dockEnabled: boolean; hasWakeTarget: boolean }) {
  const published: string[] = []
  let showDisplayCount = 0
  let abandoned = 0
  const timers: Array<() => void> = []
  const dockWindow = createRecordingDockWindow()
  const policy = createWakeHandoff({
    overlay: {
      publishWake: (command) => published.push(command),
      publishShowDisplay: () => {
        showDisplayCount += 1
      },
      get hasWakeTarget() {
        return input.hasWakeTarget
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
    showDisplayCount: () => showDisplayCount,
    abandoned: () => abandoned,
  }
}

describe('createWakeHandoff with the dock window on', () => {
  it('opens the app ONCE per wake, alongside opening the dock', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: false })
    t.policy.handoff.publishWake('what is the time')

    expect(t.published).toEqual(['what is the time'])
    // Argless launch (the shell's single-instance handler surfaces the main
    // window) + the event that points that window at the Display + the dock.
    expect(t.dockWindow.calls).toEqual(['openApp', 'open'])
    expect(t.showDisplayCount()).toBe(1)

    t.policy.handoff.publishWake('and the date')
    expect(t.dockWindow.calls.filter((call) => call === 'openApp')).toHaveLength(2)
    expect(t.showDisplayCount()).toBe(2)
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

  it('hands the microphone back when a launched dock never connects', () => {
    const t = buildHandoff({ dockEnabled: true, hasWakeTarget: false })
    t.policy.handoff.publishWake('')
    expect(t.timers).toHaveLength(1)
    t.timers[0]!()
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

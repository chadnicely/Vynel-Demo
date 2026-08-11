import { describe, it, expect } from 'vitest'
import {
  isTreeNonTrivial,
  runWakeLoop,
  resolveAppWithFallback,
  type WakeLoopDeps,
  type ResolveAppHooks,
} from './electron-wake.js'
import type { Xa11yAppInstance, Xa11yModule } from './xa11y-loader.js'

const BARE_FRAME = 'window "Discord"\n  pane ""'
const WOKEN_TREE = [
  'window "Discord"',
  '  document "Discord | #general"',
  '    navigation "Servers"',
  '      button "Direct Messages"',
  '    main "Chat"',
  '      list "Messages"',
  '        listitem "hello"',
  '        listitem "world"',
  '      textbox "Message #general"',
].join('\n')

describe('isTreeNonTrivial', () => {
  it('a bare window frame (the dead Chromium tree) is trivial', () => {
    expect(isTreeNonTrivial('')).toBe(false)
    expect(isTreeNonTrivial(BARE_FRAME)).toBe(false)
  })

  it('a document-bearing dump is non-trivial even when short', () => {
    expect(isTreeNonTrivial('window "X"\n  document "page"')).toBe(true)
  })

  it('a deep dump without a document role is non-trivial by line count', () => {
    const deep = Array.from({ length: 9 }, (_, i) => `  node ${i}`).join('\n')
    expect(isTreeNonTrivial(deep)).toBe(true)
  })
})

// A fake clock: `now` reads virtual time, `delay` advances it — the loop runs
// its real logic against deterministic time, no timers.
function fakeClock(): { now: () => number; delay: (ms: number) => Promise<void> } {
  let time = 0
  return {
    now: () => time,
    delay: (ms) => {
      time += ms
      return Promise.resolve()
    },
  }
}

const fakeApp = { fake: true } as unknown as Xa11yAppInstance

function loopDeps(overrides: Partial<WakeLoopDeps>): WakeLoopDeps {
  const clock = fakeClock()
  return {
    resolveApp: () => Promise.resolve(fakeApp),
    probeTree: () => Promise.resolve(WOKEN_TREE),
    ensureForeground: () => Promise.resolve(true),
    delay: clock.delay,
    now: clock.now,
    ...overrides,
  }
}

describe('runWakeLoop', () => {
  it('returns the moment a probe turns non-trivial (a warm app skips the old fixed sleep)', async () => {
    let probes = 0
    const deps = loopDeps({
      probeTree: () => {
        probes += 1
        return Promise.resolve(probes >= 2 ? WOKEN_TREE : BARE_FRAME)
      },
    })
    const result = await runWakeLoop(deps)
    expect(result.wakeIncomplete).toBe(false)
    expect(probes).toBe(2)
  })

  it('returns wakeIncomplete at the deadline with the last-resolved app (partial beats nothing)', async () => {
    const deps = loopDeps({ probeTree: () => Promise.resolve(BARE_FRAME) })
    const result = await runWakeLoop(deps)
    expect(result.wakeIncomplete).toBe(true)
    expect(result.app).toBe(fakeApp)
  })

  it('retries focus exactly once at the halfway mark when the first attempt failed', async () => {
    let focusAttempts = 0
    const deps = loopDeps({
      probeTree: () => Promise.resolve(BARE_FRAME),
      ensureForeground: () => {
        focusAttempts += 1
        return Promise.resolve(false)
      },
    })
    const result = await runWakeLoop(deps)
    expect(focusAttempts).toBe(2)
    expect(result.focusSucceeded).toBe(false)
  })

  it('does not retry focus when the first attempt verifiably succeeded', async () => {
    let focusAttempts = 0
    const deps = loopDeps({
      probeTree: () => Promise.resolve(BARE_FRAME),
      ensureForeground: () => {
        focusAttempts += 1
        return Promise.resolve(true)
      },
    })
    await runWakeLoop(deps)
    expect(focusAttempts).toBe(1)
  })

  it('treats a throwing probe as a trivial tree and keeps polling to the deadline', async () => {
    const deps = loopDeps({ probeTree: () => Promise.reject(new Error('UIA hiccup')) })
    const result = await runWakeLoop(deps)
    expect(result.wakeIncomplete).toBe(true)
  })
})

// A fake xa11y `App` static — `find` misses (the Electron case), `byPid`
// resolves a fake instance whose `subscribe` records closes, and `dump`
// scripts the probe sequence.
function fakeElectronApp(dumps: string[]): {
  App: Xa11yModule['App']
  subscriptionCloses: () => number
} {
  let closes = 0
  let dumpIndex = 0
  const instance = {
    name: 'Discord',
    subscribe: () =>
      Promise.resolve({
        closed: false,
        close: () => {
          closes += 1
        },
      }),
    dump: () => {
      const value = dumps[Math.min(dumpIndex, dumps.length - 1)] ?? ''
      dumpIndex += 1
      return Promise.resolve(value)
    },
  } as unknown as Xa11yAppInstance
  const App = {
    find: () => Promise.reject(new Error('not enumerated')),
    byPid: () => Promise.resolve(instance),
  } as unknown as Xa11yModule['App']
  return { App, subscriptionCloses: () => closes }
}

function resolveHooks(overrides: Partial<ResolveAppHooks> = {}) {
  const clock = fakeClock()
  const releases: number[] = []
  return {
    releases,
    hooks: {
      findPid: () => Promise.resolve(9624),
      // Default: NOT running. The tray branch is the exception, so a test that
      // wants it must ask — otherwise every "not found" case would claim the
      // app is hidden in the tray.
      isRunning: () => Promise.resolve(false),
      ensureForeground: () => Promise.resolve(true),
      acquireScreenReaderFlag: () =>
        Promise.resolve(() => {
          releases.push(1)
        }),
      delay: clock.delay,
      now: clock.now,
      // Default fake: no window source, so identity falls back to the name
      // xa11y gave. Tests that care about canonicalization override it.
      resolveIdentity: (_pid: number | null, fallbackName: string) => fallbackName,
      ...overrides,
    },
  }
}

describe('resolveAppWithFallback (Electron path, fakes only)', () => {
  it('wakes, HOLDS the subscription + flag until dispose, and reports the wake outcome', async () => {
    const { App, subscriptionCloses } = fakeElectronApp(['window "Discord"\n  document "x"'])
    const { hooks, releases } = resolveHooks()
    const resolved = await resolveAppWithFallback(App, 'discord', 'read', hooks)
    expect(resolved.viaElectronWake).toBe(true)
    expect(resolved.wakeIncomplete).toBe(false)
    expect(resolved.focusSucceeded).toBe(true)
    // Held until the caller finishes reading.
    expect(subscriptionCloses()).toBe(0)
    expect(releases).toHaveLength(0)
    resolved.dispose()
    expect(subscriptionCloses()).toBe(1)
    expect(releases).toHaveLength(1)
  })

  it('releases the subscription + flag when the wake throws (the leak guard)', async () => {
    const { App, subscriptionCloses } = fakeElectronApp([''])
    const { hooks, releases } = resolveHooks({
      ensureForeground: () => Promise.reject(new Error('powershell exploded')),
    })
    await expect(resolveAppWithFallback(App, 'discord', 'read', hooks)).rejects.toThrow(
      'powershell exploded',
    )
    expect(subscriptionCloses()).toBe(1)
    expect(releases).toHaveLength(1)
  })

  it('throws the actionable not-open error when no pid matches', async () => {
    const { App } = fakeElectronApp([''])
    const { hooks } = resolveHooks({ findPid: () => Promise.resolve(null) })
    await expect(resolveAppWithFallback(App, 'ghost', 'read', hooks)).rejects.toThrow(
      /no matching app is open/,
    )
  })

  // The system-tray case (Kafi, live, 2026-08-11 — Docker Desktop). A tray app
  // is HIDDEN, not minimized: Windows reports MainWindowHandle 0, so the
  // windowed lookup can't see it and we used to say "not open" — which is
  // false, and sent the model to the wrong recovery.
  it('says RUNNING-BUT-HIDDEN, not "not open", for an app in the system tray', async () => {
    const { App } = fakeElectronApp([''])
    const { hooks } = resolveHooks({
      findPid: () => Promise.resolve(null),
      isRunning: () => Promise.resolve(true),
    })
    const message = await resolveAppWithFallback(App, 'Docker Desktop', 'read', hooks).then(
      () => 'RESOLVED — expected a throw',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/IS running/)
    expect(message).toMatch(/system tray/)
    // And it must name the recovery that actually works.
    expect(message).toMatch(/launch_app/)
    expect(message).not.toMatch(/no matching app is open/)
  })

  it('only consults the running probe AFTER the windowed lookup fails', async () => {
    // The probe is a second PowerShell spawn; a resolved app must never pay for
    // it, and a found window must never be described as tray-hidden.
    const { App } = fakeElectronApp(['window "Discord"\n  document "x"'])
    let probed = 0
    const { hooks } = resolveHooks({
      findPid: () => Promise.resolve(9624),
      isRunning: () => {
        probed += 1
        return Promise.resolve(true)
      },
    })
    await resolveAppWithFallback(App, 'Discord', 'read', hooks)
    expect(probed).toBe(0)
  })

  it('a denial from onResolvedIdentity aborts the wake with NOTHING acquired', async () => {
    // The access-enforcement seam: identity is known after byPid, and a denied
    // app must never be flag-touched, subscribed, or foregrounded.
    const { App, subscriptionCloses } = fakeElectronApp(['window "Discord"\n  document "x"'])
    const { hooks, releases } = resolveHooks()
    const identities: string[] = []
    await expect(
      resolveAppWithFallback(App, 'discord', 'read', hooks, (appName) => {
        identities.push(appName)
        throw new Error('DENIED:no grant')
      }),
    ).rejects.toThrow('DENIED:no grant')
    expect(identities).toEqual(['Discord'])
    // Nothing was acquired, so there is nothing to release (vs. the leak-guard
    // test above, where a LATER failure must release both).
    expect(releases).toHaveLength(0)
    expect(subscriptionCloses()).toBe(0)
  })

  it('authorizes the CANONICAL app name, never the window title', async () => {
    // The live bug (2026-08-04): xa11y hands back "Vynel - Google Chrome", so
    // the grant was keyed to a tab title and died on the next tab switch.
    const App = {
      find: () => Promise.resolve({ name: 'Vynel - Google Chrome', pid: 77 }),
    } as unknown as Xa11yModule['App']
    const { hooks } = resolveHooks({
      resolveIdentity: (pid, fallbackName) => (pid === 77 ? 'Google Chrome' : fallbackName),
    })
    const identities: string[] = []
    const resolved = await resolveAppWithFallback(App, 'chrome', 'read', hooks, (name) =>
      identities.push(name),
    )
    expect(identities).toEqual(['Google Chrome'])
    resolved.dispose()
  })

  it('a fast-path denial propagates AS the denial — never retried down the pid path', async () => {
    // If the denial were caught as "not found", the pid fallback would run and
    // a findPid miss would mask the denial with "no matching app is open".
    const App = {
      find: () => Promise.resolve({ name: 'Discord' }),
      byPid: () => Promise.reject(new Error('byPid must not be reached')),
    } as unknown as Xa11yModule['App']
    let pidLookups = 0
    const { hooks } = resolveHooks({
      findPid: () => {
        pidLookups += 1
        return Promise.resolve(null)
      },
    })
    await expect(
      resolveAppWithFallback(App, 'discord', 'read', hooks, () => {
        throw new Error('DENIED:no grant')
      }),
    ).rejects.toThrow('DENIED:no grant')
    expect(pidLookups).toBe(0)
  })
})

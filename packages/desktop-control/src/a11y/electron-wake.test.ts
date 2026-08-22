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
      // Default: no packaged apps open, so the shadowed-Store-app branch stays
      // off unless a test asks for it.
      listHostedWindows: () => [] as string[],
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

// The packaged-app (Store) class. xa11y keys its app list by PROCESS and every
// Store app shares one ApplicationFrameHost, so with two open the second fails
// deep in the binding with "No element matched selector: application[pid=6280]"
// — which reads as "gone" for an app that is open and plainly visible.
describe('a Store app shadowed by its sibling', () => {
  const exploded = new Error('No element matched selector: application[pid=6280]')

  function shadowed(hostedWindows: string[]) {
    const { App } = fakeElectronApp([''])
    // Enumeration misses it, the pid resolves, and byPid is what blows up.
    const failing = {
      ...App,
      find: () => Promise.reject(new Error('no match')),
      byPid: () => Promise.reject(exploded),
    } as unknown as typeof App
    const { hooks } = resolveHooks({ listHostedWindows: () => hostedWindows })
    return { failing, hooks }
  }

  it('explains the real cause and names the door that works', async () => {
    const { failing, hooks } = shadowed(['Settings', 'Calculator'])
    const message = await resolveAppWithFallback(failing, 'Calculator', 'read', hooks).then(
      () => 'RESOLVED — expected a throw',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/Store app/i)
    expect(message).toMatch(/screenshot_app/)
    // And it must not leave the model thinking the app vanished.
    expect(message).not.toMatch(/No element matched selector/)
    expect(message).toMatch(/is open/i)
  })

  it('leaves an ordinary failure completely untouched', async () => {
    // No packaged app matches, so this is a real error and must not be dressed
    // up as a Store-app limitation.
    const { failing, hooks } = shadowed([])
    await expect(resolveAppWithFallback(failing, 'Discord', 'read', hooks)).rejects.toThrow(
      exploded,
    )
  })

  it('does not claim it for a DIFFERENT packaged app that happens to be open', async () => {
    const { failing, hooks } = shadowed(['Settings'])
    await expect(resolveAppWithFallback(failing, 'Photos', 'read', hooks)).rejects.toThrow(exploded)
  })
})

// The path the LIVE case actually takes (measured 2026-08-12). The shared host
// process exposes only ONE MainWindowTitle, so findWindowedPidByName cannot see
// the sibling and returns null — landing on the tray branch, which then declares
// a plainly-visible window "minimized to the system tray". Confidently wrong is
// worse than opaque.
describe('a shadowed Store app is not in the system tray', () => {
  it('says Store-app, NOT tray, when the pid lookup cannot see the sibling', async () => {
    const { App } = fakeElectronApp([''])
    const failing = {
      ...App,
      find: () => Promise.reject(new Error('no match')),
    } as unknown as typeof App
    const { hooks } = resolveHooks({
      findPid: () => Promise.resolve(null),
      // The tray probe WOULD say yes — the process is running — which is exactly
      // how the wrong message won before.
      isRunning: () => Promise.resolve(true),
      listHostedWindows: () => ['Calculator', 'Settings'],
    })
    const message = await resolveAppWithFallback(failing, 'Settings', 'read', hooks).then(
      () => 'RESOLVED — expected a throw',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/Store app/i)
    expect(message).toMatch(/screenshot_app/)
    expect(message).not.toMatch(/system tray/)
  })

  it('still reports the tray for a genuine tray app', async () => {
    const { App } = fakeElectronApp([''])
    const { hooks } = resolveHooks({
      findPid: () => Promise.resolve(null),
      isRunning: () => Promise.resolve(true),
      listHostedWindows: () => ['Calculator'],
    })
    const message = await resolveAppWithFallback(App, 'Docker Desktop', 'read', hooks).then(
      () => 'RESOLVED — expected a throw',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/system tray/)
    expect(message).not.toMatch(/Store app/i)
  })
})

// The ENUMERATED path — the one that used to focus nothing.
//
// Kafi, 2026-08-22: "on Discord it was getting to the front — sometimes not."
// Root cause: only the byPid/wake path focused, so which behaviour an app got
// depended on whether xa11y could enumerate it. For a Chromium app that flips
// with the liveness of its accessibility tree, which is a side effect of our
// OWN earlier calls — so the same tool with the same arguments behaved
// differently minutes apart. Measured live: App.find succeeded for Discord,
// qBittorrent and Telegram while all three were open.
describe('resolveAppWithFallback (enumerated path)', () => {
  function fakeEnumeratedApp(pid: number | null = 4242) {
    const instance = { name: 'Discord', pid } as unknown as Xa11yAppInstance
    return {
      find: () => Promise.resolve(instance),
      byPid: () => Promise.reject(new Error('byPid must not be used on the enumerated path')),
    } as unknown as Xa11yModule['App']
  }

  it('brings an ENUMERATED app to the front too — the intermittency fix', async () => {
    const focused: number[] = []
    const { hooks } = resolveHooks({
      ensureForeground: (pid: number) => {
        focused.push(pid)
        return Promise.resolve(true)
      },
    })
    const resolved = await resolveAppWithFallback(fakeEnumeratedApp(), 'discord', 'act on', hooks)
    expect(resolved.viaElectronWake).toBe(false)
    expect(focused).toEqual([4242])
    // No longer null: the caller can now tell "focused" from "never tried".
    expect(resolved.focusSucceeded).toBe(true)
  })

  it('reports a REFUSED focus rather than silently claiming nothing happened', async () => {
    const { hooks } = resolveHooks({ ensureForeground: () => Promise.resolve(false) })
    const resolved = await resolveAppWithFallback(fakeEnumeratedApp(), 'discord', 'act on', hooks)
    expect(resolved.focusSucceeded).toBe(false)
  })

  it('enforces identity BEFORE focusing — raising a window is actuation', async () => {
    const order: string[] = []
    const { hooks } = resolveHooks({
      ensureForeground: () => {
        order.push('focus')
        return Promise.resolve(true)
      },
    })
    await expect(
      resolveAppWithFallback(fakeEnumeratedApp(), 'discord', 'act on', hooks, () => {
        order.push('enforce')
        throw new Error('denied')
      }),
    ).rejects.toThrow('denied')
    // A denied app must never be raised.
    expect(order).toEqual(['enforce'])
  })

  it('skips focus for a pid-less app instead of guessing a target', async () => {
    const focused: number[] = []
    const { hooks } = resolveHooks({
      ensureForeground: (pid: number) => {
        focused.push(pid)
        return Promise.resolve(true)
      },
    })
    const resolved = await resolveAppWithFallback(fakeEnumeratedApp(null), 'discord', 'read', hooks)
    expect(focused).toEqual([])
    expect(resolved.focusSucceeded).toBeNull()
  })
})

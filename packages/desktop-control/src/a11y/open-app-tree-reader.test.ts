// The identity a HELD tree reader re-authorizes against.
//
// Live smoke, 2026-08-11: `wait_for` on Discord failed with
//   Desktop access denied for "music | localhost - Discord"
// moments after the user had approved a grant for "Discord" — and a
// `snapshot_app` on the same query immediately afterwards worked fine.
//
// Cause: xa11y names an app by its active WINDOW TITLE, which for an Electron
// app is the channel/server line and changes as the user navigates. Resolution
// already handles that — it maps the pid to the real app name and hands THAT to
// the authorizer — but the per-read re-check used `resolved.app.name`, the raw
// xa11y name, so it asked about a string no grant could ever match.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { DesktopAccessTier } from '../access/desktop-access-tiers.js'

const CANONICAL = 'Discord'
/** What xa11y actually calls the same app — the live window title. */
const WINDOW_TITLE = 'music🎧 | localhost – Discord'

const dumpApp = vi.fn(async () => '<tree/>')
const dispose = vi.fn()

vi.mock('./xa11y-loader.js', () => ({
  loadXa11y: () => ({ App: {} }),
  dumpApp: (...args: unknown[]) => dumpApp(...(args as [])),
  withTimeout: <T>(promise: Promise<T>) => promise,
  // The timeout helpers moved here alongside `withTimeout`; the adapter imports
  // them, so the mock has to carry them or the module fails to load.
  resolveDesktopTimeout: (requested: number | undefined, fallback: number) =>
    requested ?? fallback,
  MAX_DESKTOP_TIMEOUT_MS: 120_000,
}))

vi.mock('./electron-wake.js', () => ({
  resolveAppWithFallback: async (
    _App: unknown,
    _query: string,
    _intent: string,
    _opts: unknown,
    onResolvedIdentity?: (appName: string) => void,
  ) => {
    // Resolution reports the CANONICAL identity…
    onResolvedIdentity?.(CANONICAL)
    // …while the app object it returns is still named by window title.
    return {
      app: { name: WINDOW_TITLE },
      dispose,
      viaElectronWake: true,
      wakeIncomplete: false,
      focusSucceeded: true,
    }
  },
}))

const { openAppTreeReader } = await import('./open-app-tree-reader.js')

describe('openAppTreeReader — the identity it re-authorizes against', () => {
  beforeEach(() => {
    dumpApp.mockClear()
    dispose.mockClear()
  })

  it('resolves ONCE however many reads happen — the wake is held, not repeated', async () => {
    const reader = await openAppTreeReader('discord')
    await reader.readTree()
    await reader.readTree()
    await reader.readTree()
    expect(dumpApp).toHaveBeenCalledTimes(3)
    // One resolution => one dispose to release the flag + subscription.
    expect(dispose).not.toHaveBeenCalled()
    reader.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

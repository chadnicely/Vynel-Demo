import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { buildDisplayDockLaunchCommand, createDisplayDockWindow } from './display-dock-window.js'
import type { CommandSpawner, SpawnedCommand } from './display-dock-window.js'

// The spawn side is a fire-and-forget shell call (smoke-verified live); the
// invocation building and WHICH exe/args each door spawns are the parts worth
// pinning. Whether a launch actually produced a dock is not decided here — it
// is decided by a dock connecting, which `wake-handoff.test.ts` covers.

describe('buildDisplayDockLaunchCommand', () => {
  it('uses `start` on Windows so the browser resolves via App Paths, not PATH', () => {
    expect(buildDisplayDockLaunchCommand('chrome', 'http://localhost:8999/display-dock', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'chrome', '--app=http://localhost:8999/display-dock', '--window-size=420,560'],
    })
  })

  it('maps msedge to its macOS app name', () => {
    expect(buildDisplayDockLaunchCommand('msedge', 'http://localhost:8999/display-dock', 'darwin')).toEqual({
      command: 'open',
      args: ['-na', 'Microsoft Edge', '--args', '--app=http://localhost:8999/display-dock', '--window-size=420,560'],
    })
  })

  it('calls the browser binary directly on linux', () => {
    expect(buildDisplayDockLaunchCommand('chrome', 'http://localhost:8999/display-dock', 'linux')).toEqual({
      command: 'google-chrome',
      args: ['--app=http://localhost:8999/display-dock', '--window-size=420,560'],
    })
  })
})

interface FakeSpawnedCommand extends SpawnedCommand {
  emitError(error: Error): void
}

function createFakeSpawnedCommand(): FakeSpawnedCommand {
  let errorListener: ((error: Error) => void) | undefined
  return {
    onError: (listener) => (errorListener = listener),
    emitError: (error) => errorListener?.(error),
  }
}

function createSpawnRecorder(): {
  calls: { command: string; args: readonly string[]; handle: FakeSpawnedCommand }[]
  spawner: CommandSpawner
} {
  const calls: { command: string; args: readonly string[]; handle: FakeSpawnedCommand }[] = []
  const spawner: CommandSpawner = (command, args) => {
    const handle = createFakeSpawnedCommand()
    calls.push({ command, args, handle })
    return handle
  }
  return { calls, spawner }
}

const DOCK_URL = 'http://localhost:18894/display-dock'
const logger = pino({ level: 'silent' })

// process.execPath: a real file on every machine — the appPath existsSync gate
// must pass for the desktop-shell branch to run at all.
function createOverlayWindow(recorder: ReturnType<typeof createSpawnRecorder>) {
  return createDisplayDockWindow(
    { browser: 'chrome', url: DOCK_URL, appPath: process.execPath },
    logger,
    recorder.spawner,
  )
}

describe('createDisplayDockWindow hasApp', () => {
  it('answers whether the desktop shell is on this machine', () => {
    const recorder = createSpawnRecorder()
    expect(createOverlayWindow(recorder).hasApp).toBe(true)
    expect(
      createDisplayDockWindow({ browser: 'chrome', url: DOCK_URL }, logger, recorder.spawner).hasApp,
    ).toBe(false)
  })
})

describe('createDisplayDockWindow openApp()', () => {
  // ARGLESS is the whole point: one process builds the main window and the
  // dock webview together, so this is the dock's launch as much as the app's.
  // `--dock-only` would be a second process racing the first for the shell.
  it('launches the exe with NO args — one shell, both windows', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).openApp()
    expect(recorder.calls).toEqual([
      expect.objectContaining({ command: process.execPath, args: [] }),
    ])
  })

  it('does nothing at all without a desktop app on this machine', () => {
    const recorder = createSpawnRecorder()
    createDisplayDockWindow({ browser: 'chrome', url: DOCK_URL }, logger, recorder.spawner).openApp()
    expect(recorder.calls).toHaveLength(0)
  })
})

describe('createDisplayDockWindow openBrowser()', () => {
  it('opens the chromeless window on the dock route', () => {
    const recorder = createSpawnRecorder()
    createDisplayDockWindow({ browser: 'chrome', url: DOCK_URL }, logger, recorder.spawner).openBrowser()
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.args).toContain(`--app=${DOCK_URL}`)
  })

  // The handoff calls this after its own connect window, so a machine WITH a
  // desktop app still reaches the browser when that app never came up.
  it('opens the browser even with a desktop app present', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).openBrowser()
    expect(recorder.calls[0]?.args).toContain(`--app=${DOCK_URL}`)
  })

  it('logs rather than throws when the shell call cannot start', () => {
    const recorder = createSpawnRecorder()
    createDisplayDockWindow({ browser: 'chrome', url: DOCK_URL }, logger, recorder.spawner).openBrowser()
    expect(() => recorder.calls[0]?.handle.emitError(new Error('spawn failed'))).not.toThrow()
  })
})

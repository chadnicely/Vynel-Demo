import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { buildDisplayDockLaunchCommand, createDisplayDockWindow } from './display-dock-window.js'
import type { CommandSpawner, SpawnedCommand } from './display-dock-window.js'

// The spawn side is a fire-and-forget shell call (smoke-verified live); the
// invocation building and the failed-launch fallback are the parts worth
// pinning — a broken overlay exe once swallowed every wake without a trace.

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
  emitExit(code?: number | null): void
}

function createFakeSpawnedCommand(): FakeSpawnedCommand {
  let errorListener: ((error: Error) => void) | undefined
  let exitListener: ((code: number | null) => void) | undefined
  return {
    onError: (listener) => (errorListener = listener),
    onExit: (listener) => (exitListener = listener),
    emitError: (error) => errorListener?.(error),
    emitExit: (code = 1) => exitListener?.(code),
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
// must pass for the overlay-preferred branch to run at all.
function createOverlayWindow(recorder: ReturnType<typeof createSpawnRecorder>) {
  return createDisplayDockWindow(
    { browser: 'chrome', url: DOCK_URL, appPath: process.execPath },
    logger,
    recorder.spawner,
  )
}

describe('createDisplayDockWindow open()', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the browser window directly when no overlay exe exists', () => {
    const recorder = createSpawnRecorder()
    const window = createDisplayDockWindow({ browser: 'chrome', url: DOCK_URL }, logger, recorder.spawner)
    window.open()
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.args).toContain(`--app=${DOCK_URL}`)
  })

  it('prefers the overlay exe and leaves the browser closed while it stays up', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).open()
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.command).toBe(process.execPath)
    expect(recorder.calls[0]?.args).toEqual(['--dock-only'])
  })

  it('falls back to the browser window when the overlay exe exits immediately', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).open()
    recorder.calls[0]?.handle.emitExit()
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[1]?.args).toContain(`--app=${DOCK_URL}`)
  })

  it('treats a late exit as a closed window, not a failed launch', () => {
    vi.useFakeTimers()
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).open()
    vi.setSystemTime(Date.now() + 10_000)
    recorder.calls[0]?.handle.emitExit()
    expect(recorder.calls).toHaveLength(1)
  })

  it('falls back only once when error and exit both fire for one launch', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).open()
    recorder.calls[0]?.handle.emitError(new Error('spawn failed'))
    recorder.calls[0]?.handle.emitExit()
    expect(recorder.calls).toHaveLength(2)
  })
})

describe('createDisplayDockWindow openApp()', () => {
  it('launches the same exe with NO args — the shell surfaces its main window', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).openApp()
    expect(recorder.calls).toEqual([
      expect.objectContaining({ command: process.execPath, args: [] }),
    ])
  })

  it('never falls back to the browser — an immediate exit is single-instance routing, not a crash', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).openApp()
    recorder.calls[0]?.handle.emitExit(0)
    expect(recorder.calls).toHaveLength(1)
  })

  it('does nothing at all without a desktop app on this machine', () => {
    const recorder = createSpawnRecorder()
    createDisplayDockWindow({ browser: 'chrome', url: DOCK_URL }, logger, recorder.spawner).openApp()
    expect(recorder.calls).toHaveLength(0)
  })
})

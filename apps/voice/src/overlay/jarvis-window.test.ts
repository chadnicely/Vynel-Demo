import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { buildJarvisLaunchCommand, createJarvisWindow } from './jarvis-window.js'
import type { CommandSpawner, SpawnedCommand } from './jarvis-window.js'

// The spawn side is a fire-and-forget shell call (smoke-verified live); the
// invocation building and the failed-launch fallback are the parts worth
// pinning — a broken overlay exe once swallowed every wake without a trace.

describe('buildJarvisLaunchCommand', () => {
  it('uses `start` on Windows so the browser resolves via App Paths, not PATH', () => {
    expect(buildJarvisLaunchCommand('chrome', 'http://localhost:8999/jarvis', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'chrome', '--app=http://localhost:8999/jarvis', '--window-size=420,560'],
    })
  })

  it('maps msedge to its macOS app name', () => {
    expect(buildJarvisLaunchCommand('msedge', 'http://localhost:8999/jarvis', 'darwin')).toEqual({
      command: 'open',
      args: ['-na', 'Microsoft Edge', '--args', '--app=http://localhost:8999/jarvis', '--window-size=420,560'],
    })
  })

  it('calls the browser binary directly on linux', () => {
    expect(buildJarvisLaunchCommand('chrome', 'http://localhost:8999/jarvis', 'linux')).toEqual({
      command: 'google-chrome',
      args: ['--app=http://localhost:8999/jarvis', '--window-size=420,560'],
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

const JARVIS_URL = 'http://localhost:18894/jarvis'
const logger = pino({ level: 'silent' })

// process.execPath: a real file on every machine — the appPath existsSync gate
// must pass for the overlay-preferred branch to run at all.
function createOverlayWindow(recorder: ReturnType<typeof createSpawnRecorder>) {
  return createJarvisWindow(
    { browser: 'chrome', url: JARVIS_URL, appPath: process.execPath },
    logger,
    recorder.spawner,
  )
}

describe('createJarvisWindow open()', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the browser window directly when no overlay exe exists', () => {
    const recorder = createSpawnRecorder()
    const window = createJarvisWindow({ browser: 'chrome', url: JARVIS_URL }, logger, recorder.spawner)
    window.open()
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.args).toContain(`--app=${JARVIS_URL}`)
  })

  it('prefers the overlay exe and leaves the browser closed while it stays up', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).open()
    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]?.command).toBe(process.execPath)
    expect(recorder.calls[0]?.args).toEqual(['--jarvis-only'])
  })

  it('falls back to the browser window when the overlay exe exits immediately', () => {
    const recorder = createSpawnRecorder()
    createOverlayWindow(recorder).open()
    recorder.calls[0]?.handle.emitExit()
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[1]?.args).toContain(`--app=${JARVIS_URL}`)
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

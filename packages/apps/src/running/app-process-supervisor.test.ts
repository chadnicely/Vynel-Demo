// Real processes, no mocks: the supervisor spawns actual `node -e` children
// (node is by definition present in the test environment; shell:true works on
// win32 and POSIX alike).

import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppProcessSupervisor, resolveContainedCwd } from './app-process-supervisor.js'

const workspacePath = mkdtempSync(join(tmpdir(), 'vynel-apps-'))

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolvePoll, rejectPoll) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolvePoll()
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        rejectPoll(new Error('waitFor timed out'))
      }
    }, 50)
  })
}

describe('resolveContainedCwd', () => {
  it('accepts the root + subpaths, refuses escapes and absolutes', () => {
    expect(resolveContainedCwd(workspacePath, '')).toBe(workspacePath)
    expect(resolveContainedCwd(workspacePath, 'apps/web')).toContain(workspacePath)
    expect(resolveContainedCwd(workspacePath, '../outside')).toBeNull()
    expect(resolveContainedCwd(workspacePath, 'a/../../outside')).toBeNull()
  })
})

describe('AppProcessSupervisor', () => {
  it('runs a process, captures its output, records a clean exit', async () => {
    const supervisor = new AppProcessSupervisor()
    supervisor.start({
      appId: 'app-1',
      name: 'Echo',
      command: `node -e "console.log('hello from the app')"`,
      workspacePath,
      cwdRelative: '',
    })
    expect(supervisor.snapshotOf('app-1')?.status).toBe('running')

    await waitFor(() => supervisor.snapshotOf('app-1')?.status !== 'running')
    const snapshot = supervisor.snapshotOf('app-1')!
    expect(snapshot.status).toBe('exited')
    expect(snapshot.exitCode).toBe(0)
    expect(supervisor.logsOf('app-1').join('\n')).toContain('hello from the app')
  })

  it('a non-zero self-exit is a crash and fires onExit', async () => {
    const onExit = vi.fn()
    const supervisor = new AppProcessSupervisor({ onExit })
    supervisor.start({
      appId: 'app-2',
      name: 'Crasher',
      command: `node -e "process.exit(3)"`,
      workspacePath,
      cwdRelative: '',
    })
    await waitFor(() => supervisor.snapshotOf('app-2')?.status !== 'running')
    expect(supervisor.snapshotOf('app-2')?.status).toBe('crashed')
    expect(onExit).toHaveBeenCalledWith('app-2', { exitCode: 3, crashed: true })
  })

  it('stop() ends a long-running process as a requested exit (no crash, no onExit)', async () => {
    const onExit = vi.fn()
    const supervisor = new AppProcessSupervisor({ onExit })
    supervisor.start({
      appId: 'app-3',
      name: 'Server',
      command: `node -e "setInterval(() => {}, 1000)"`,
      workspacePath,
      cwdRelative: '',
    })
    expect(supervisor.isRunning('app-3')).toBe(true)

    await supervisor.stop('app-3')
    expect(supervisor.snapshotOf('app-3')?.status).toBe('exited')
    expect(onExit).not.toHaveBeenCalled()
    // Idempotent — stopping again resolves immediately.
    await supervisor.stop('app-3')
  })

  it('a FAILED spawn settles as crashed (never a ghost "running"), and stop() still resolves', async () => {
    // The reviewer's must-fix case: containment is textual, so a registered
    // folder that does not exist passes validation and fails at spawn —
    // 'error' fires, 'exit' never does. The supervisor must settle anyway.
    const onExit = vi.fn()
    const supervisor = new AppProcessSupervisor({ onExit })
    supervisor.start({
      appId: 'app-ghost',
      name: 'Ghost',
      command: 'node -e ""',
      workspacePath,
      cwdRelative: 'does-not-exist',
    })

    await waitFor(() => supervisor.snapshotOf('app-ghost')?.status !== 'running')
    expect(supervisor.snapshotOf('app-ghost')?.status).toBe('crashed')
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(supervisor.logsOf('app-ghost').join('\n')).toContain('failed to start')

    // The hang path: stop() on the settled entry resolves immediately, and a
    // restart is possible (no permanent 409).
    await supervisor.stop('app-ghost')
    supervisor.start({
      appId: 'app-ghost',
      name: 'Ghost',
      command: `node -e "console.log('revived')"`,
      workspacePath,
      cwdRelative: '',
    })
    await waitFor(() => supervisor.snapshotOf('app-ghost')?.status !== 'running')
    expect(supervisor.snapshotOf('app-ghost')?.status).toBe('exited')
  })

  it('a throwing onExit hook never escapes the exit handler', async () => {
    const supervisor = new AppProcessSupervisor({
      onExit: () => {
        throw new Error('db is closed')
      },
    })
    supervisor.start({
      appId: 'app-hook',
      name: 'Hook',
      command: `node -e "process.exit(2)"`,
      workspacePath,
      cwdRelative: '',
    })
    // Settles as crashed despite the throwing hook (an uncaught throw here
    // would fail this test via vitest's unhandled-error detection).
    await waitFor(() => supervisor.snapshotOf('app-hook')?.status !== 'running')
    expect(supervisor.snapshotOf('app-hook')?.status).toBe('crashed')
  })

  it('refuses a second start while running and a cwd escaping the workspace', async () => {
    const supervisor = new AppProcessSupervisor()
    supervisor.start({
      appId: 'app-4',
      name: 'Server',
      command: `node -e "setInterval(() => {}, 1000)"`,
      workspacePath,
      cwdRelative: '',
    })
    expect(() =>
      supervisor.start({
        appId: 'app-4',
        name: 'Server',
        command: 'node -e ""',
        workspacePath,
        cwdRelative: '',
      }),
    ).toThrow(/app_already_running/)
    expect(() =>
      supervisor.start({
        appId: 'app-5',
        name: 'Escape',
        command: 'node -e ""',
        workspacePath,
        cwdRelative: '../outside',
      }),
    ).toThrow(/app_cwd_escapes_workspace/)
    await supervisor.stopAll()
    expect(supervisor.isRunning('app-4')).toBe(false)
  })
})

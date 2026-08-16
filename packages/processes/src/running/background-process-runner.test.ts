// Tests for the runner — REAL child processes (tiny `node -e` commands), no
// mocks: the settle-once guard, the kill paths, and the deadline are exactly
// the mechanics that only break for real.

import { describe, expect, it } from 'vitest'
import { BackgroundProcessRunner } from './background-process-runner.js'
import type { ProcessExitOutcome } from '../processes-types.js'

/** A runner wired to resolve a promise on the FIRST settle of `processId`. */
function makeRunnerWithSettle(): {
  runner: BackgroundProcessRunner
  settled: Promise<{ processId: string; outcome: ProcessExitOutcome }>
  settleCount: () => number
} {
  let resolveSettled!: (value: { processId: string; outcome: ProcessExitOutcome }) => void
  const settled = new Promise<{ processId: string; outcome: ProcessExitOutcome }>((resolve) => {
    resolveSettled = resolve
  })
  let count = 0
  const runner = new BackgroundProcessRunner({
    onExit: (processId, outcome) => {
      count += 1
      if (count === 1) resolveSettled({ processId, outcome })
    },
  })
  return { runner, settled, settleCount: () => count }
}

describe('BackgroundProcessRunner', () => {
  it('runs a command to a clean exit and reports code 0 with the output tail', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-ok',
      command: 'node -e "console.log(\'all green\')"',
      cwdPath: process.cwd(),
      timeoutMs: 30_000,
    })
    const { processId, outcome } = await settled
    expect(processId).toBe('p-ok')
    expect(outcome.exitCode).toBe(0)
    expect(outcome.failureReason).toBeUndefined()
    expect(outcome.outputTail).toContain('all green')
    expect(runner.isRunning('p-ok')).toBe(false)
  })

  it('strips terminal escape sequences at capture — tails read as text, not codes', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    // The ESC bytes are COMPOSED at runtime on both sides so no quoting layer
    // can eat them: the child prints a colored line, the tail must not.
    runner.start({
      processId: 'p-ansi',
      command:
        'node -e "process.stdout.write(String.fromCharCode(27)+\'[36mpainted\'+String.fromCharCode(27)+\'[0m plain\')"',
      cwdPath: process.cwd(),
      timeoutMs: 30_000,
    })
    const { outcome } = await settled
    expect(outcome.outputTail).toContain('painted')
    expect(outcome.outputTail).toContain('plain')
    expect(outcome.outputTail).not.toContain(String.fromCharCode(27))
    expect(outcome.outputTail).not.toContain('[36m')
  })

  it('reports a non-zero exit code as-is (no failureReason — the code IS the story)', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-fail',
      command: 'node -e "console.error(\'3 tests failed\'); process.exit(3)"',
      cwdPath: process.cwd(),
      timeoutMs: 30_000,
    })
    const { outcome } = await settled
    expect(outcome.exitCode).toBe(3)
    expect(outcome.failureReason).toBeUndefined()
    expect(outcome.outputTail).toContain('3 tests failed')
  })

  it('a spawn that cannot start settles as spawn-failed instead of hanging', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-nocwd',
      command: 'node -e "process.exit(0)"',
      // A cwd that does not exist — the one shape where spawn emits `error`
      // and `exit` never fires (the supervisor verified this empirically).
      cwdPath: `${process.cwd()}/definitely-not-a-real-directory-xyz`,
      timeoutMs: 30_000,
    })
    const { outcome } = await settled
    expect(outcome.failureReason).toBe('spawn-failed')
    expect(runner.isRunning('p-nocwd')).toBe(false)
  })

  it('kill ends a long-running command and the settle names the reason', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-kill',
      command: 'node -e "setInterval(() => {}, 1000)"',
      cwdPath: process.cwd(),
      timeoutMs: 60_000,
    })
    // Give the child a beat to actually exist before killing its tree.
    await new Promise((resolve) => setTimeout(resolve, 300))
    runner.kill('p-kill', 'killed')
    const { outcome } = await settled
    expect(outcome.failureReason).toBe('killed')
    expect(runner.isRunning('p-kill')).toBe(false)
  })

  it('the deadline kills a process that outlives its timeout', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-timeout',
      command: 'node -e "setInterval(() => {}, 1000)"',
      cwdPath: process.cwd(),
      timeoutMs: 500,
    })
    const { outcome } = await settled
    expect(outcome.failureReason).toBe('timed-out')
  })

  it('settles exactly ONCE however it ends (the settle-once guard)', async () => {
    const { runner, settled, settleCount } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-once',
      command: 'node -e "process.exit(0)"',
      cwdPath: process.cwd(),
      timeoutMs: 30_000,
    })
    await settled
    // A late kill on a settled process must be a silent no-op, never a
    // second settle.
    runner.kill('p-once', 'killed')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(settleCount()).toBe(1)
  })

  it('rejects a duplicate start for a live process id', async () => {
    const { runner, settled } = makeRunnerWithSettle()
    runner.start({
      processId: 'p-dup',
      command: 'node -e "setInterval(() => {}, 1000)"',
      cwdPath: process.cwd(),
      timeoutMs: 60_000,
    })
    expect(() =>
      runner.start({
        processId: 'p-dup',
        command: 'node -e "process.exit(0)"',
        cwdPath: process.cwd(),
        timeoutMs: 60_000,
      }),
    ).toThrow(/already running/)
    runner.kill('p-dup', 'killed')
    await settled
  })
})

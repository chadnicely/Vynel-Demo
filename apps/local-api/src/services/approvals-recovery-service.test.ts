// Unit test for the api-side approvals recovery service shell. The reap LOGIC is
// covered in packages/approvals (recover-stale-pending-approvals.test.ts); here we
// assert the 60s interval wiring, that the injected unblockProvider denies at the
// provider with the timeout steer, and that stop() halts the timer. Fake timers
// drive the cadence (the channels-service test pattern).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'

const { recoverMock } = vi.hoisted(() => ({ recoverMock: vi.fn() }))

vi.mock('@vynel/approvals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vynel/approvals')>()),
  recoverStalePendingApprovals: recoverMock,
}))

import { APPROVAL_TIMED_OUT_DENY_REASON } from '@vynel/approvals'
import { startApprovalsRecoveryService } from './approvals-recovery-service.js'

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    provider: { respondToApprovalRequest: vi.fn(async () => {}) } as unknown as AiAgentProvider,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  recoverMock.mockResolvedValue({ resolvedCount: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startApprovalsRecoveryService', () => {
  it('runs the reaper every 60s and stop() halts it', async () => {
    const options = fakeOptions()
    const service = startApprovalsRecoveryService(options)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(recoverMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(recoverMock).toHaveBeenCalledTimes(2)

    service.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(recoverMock).toHaveBeenCalledTimes(2)
  })

  it('wires unblockProvider to a provider DENIAL with the timeout steer', async () => {
    const options = fakeOptions()
    startApprovalsRecoveryService(options)
    await vi.advanceTimersByTimeAsync(60_000)

    const deps = recoverMock.mock.calls[0]![1] as {
      unblockProvider: (id: string) => Promise<void>
    }
    await deps.unblockProvider('appr-7')
    expect(options.provider.respondToApprovalRequest).toHaveBeenCalledWith('appr-7', {
      kind: 'denied',
      reason: APPROVAL_TIMED_OUT_DENY_REASON,
    })
  })

  it('logs (never throws) when a reap pass rejects', async () => {
    const options = fakeOptions()
    recoverMock.mockRejectedValueOnce(new Error('db locked'))
    startApprovalsRecoveryService(options)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(options.logger.error).toHaveBeenCalled()
  })
})

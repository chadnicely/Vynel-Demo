// Unit test for the api-side channels service shell. The two tick runners are
// mocked (@vynel/channels); we assert the poll(5s) / deliver(2s) interval
// wiring and that stop() halts both. Fake timers drive the cadence. The tick
// LOGIC is covered by the ported tick tests in packages/channels.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'

const { pollMock, deliverMock } = vi.hoisted(() => ({ pollMock: vi.fn(), deliverMock: vi.fn() }))

vi.mock('@vynel/channels', () => ({
  runChannelPollingTick: pollMock,
  runChannelDeliveryTick: deliverMock,
  extractErrorMessage: (err: unknown) => String(err),
}))

import { startChannelsService } from './channels-service.js'

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  pollMock.mockResolvedValue({ polledChannelCount: 0, insertedMessageCount: 0 })
  deliverMock.mockResolvedValue({ sentCount: 0, failedCount: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startChannelsService', () => {
  it('runs the delivery tick every 2s and the polling tick every 5s', async () => {
    const service = startChannelsService(fakeOptions())

    // At 2s: delivery fired once, polling not yet.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(deliverMock).toHaveBeenCalledTimes(1)
    expect(pollMock).toHaveBeenCalledTimes(0)

    // At 5s: polling has fired once (delivery at 4s → twice by now).
    await vi.advanceTimersByTimeAsync(3_000)
    expect(pollMock).toHaveBeenCalledTimes(1)
    expect(deliverMock).toHaveBeenCalledTimes(2)

    service.stop()
  })

  it('stop() halts both loops', async () => {
    const service = startChannelsService(fakeOptions())
    await vi.advanceTimersByTimeAsync(5_000)
    const pollCalls = pollMock.mock.calls.length
    const deliverCalls = deliverMock.mock.calls.length
    service.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pollMock.mock.calls.length).toBe(pollCalls)
    expect(deliverMock.mock.calls.length).toBe(deliverCalls)
  })
})

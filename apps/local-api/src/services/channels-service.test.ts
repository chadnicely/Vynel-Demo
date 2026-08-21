// Unit test for the api-side channels service shell. The tick runners +
// processing entry point are mocked (@vynel/channels); we assert the
// poll(5s) / process(1s) / deliver(2s) interval wiring, that the processing
// tick fires each pending inbound message concurrently, that every channel
// turn reaches the runner BOUNDED (the interactive wall clock, BT4), and that
// stop() halts all three. Fake timers drive the cadence. The tick + processing
// LOGIC is covered by the ported tests in packages/channels; `runGlobalRootTurn`
// is mocked here so the service test never pulls the session runner / SDK.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { ProcessInboundDeps } from '@vynel/channels'

const { pollMock, deliverMock, processMock, listPendingMock, runGlobalRootTurnMock } = vi.hoisted(
  () => ({
    pollMock: vi.fn(),
    deliverMock: vi.fn(),
    processMock: vi.fn(),
    listPendingMock: vi.fn(),
    runGlobalRootTurnMock: vi.fn(),
  }),
)

vi.mock('@vynel/channels', () => ({
  runChannelPollingTick: pollMock,
  runChannelDeliveryTick: deliverMock,
  processInboundMessage: processMock,
  listPendingInboundMessages: listPendingMock,
  extractErrorMessage: (err: unknown) => String(err),
}))

// Keep the session runner (and its SDK/composer imports) out of this shell test.
vi.mock('../sessions/run-global-root-turn.js', () => ({
  runGlobalRootTurn: runGlobalRootTurnMock,
}))

import { startChannelsService } from './channels-service.js'
import { SessionActivityFeed } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { loadEnv } from '../env.js'

function fakeOptions() {
  return {
    db: {} as unknown as Database,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    appRequest: vi.fn(),
    activityFeed: new SessionActivityFeed(),
    // A workspace-scoped channel's turn takes the workspace's single-writer key.
    targetLocks: new SessionTargetLocks(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  pollMock.mockResolvedValue({ polledChannelCount: 0, insertedMessageCount: 0 })
  deliverMock.mockResolvedValue({ sentCount: 0, failedCount: 0 })
  processMock.mockResolvedValue(undefined)
  listPendingMock.mockReturnValue([])
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

  it('processes each pending inbound message every 1s', async () => {
    listPendingMock.mockReturnValue([{ id: 'in-1' }, { id: 'in-2' }])
    const service = startChannelsService(fakeOptions())

    await vi.advanceTimersByTimeAsync(1_000)

    expect(listPendingMock).toHaveBeenCalledTimes(1)
    expect(processMock).toHaveBeenCalledTimes(2)
    expect(processMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { inboundMessageId: 'in-1' },
      expect.anything(),
    )
    expect(processMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { inboundMessageId: 'in-2' },
      expect.anything(),
    )

    service.stop()
  })

  // The channel turn is the one `${userId}` root-lock holder that had no bound
  // (audit R2-B): the service hands the runner the streams' wall clock.
  describe('the channel turn is bounded (BT4)', () => {
    /** Drive one processing tick and return the `runRootTurn` dep the service
     *  injected — the seam the channels leaf calls the runner through. */
    async function captureRunRootTurn(
      options: Parameters<typeof startChannelsService>[0],
    ): Promise<ProcessInboundDeps['runRootTurn']> {
      listPendingMock.mockReturnValue([{ id: 'in-1' }])
      const service = startChannelsService(options)
      await vi.advanceTimersByTimeAsync(1_000)
      service.stop()
      const turnDeps = processMock.mock.calls[0]?.[2] as ProcessInboundDeps
      return turnDeps.runRootTurn
    }

    const inbound = {
      userId: 'u1',
      userMessageText: 'hi',
      origin: { channelId: 'c1', externalSenderId: 's1', externalChatContextId: 'ctx1' },
      originChannel: 'telegram' as const,
    }

    it('passes the runner `wallClock` with the interactive knob (VYNEL_INTERACTIVE_TURN_MAX_MS) by default', async () => {
      runGlobalRootTurnMock.mockResolvedValue({ sessionId: 'sess-1', resultText: '' })
      const runRootTurn = await captureRunRootTurn(fakeOptions())
      const turnDb = { tag: 'per-call' } as unknown as Database
      await runRootTurn(turnDb, inbound)
      expect(runGlobalRootTurnMock).toHaveBeenCalledTimes(1)
      const [deps, input] = runGlobalRootTurnMock.mock.calls[0] as [
        { db: Database },
        Record<string, unknown>,
      ]
      // The per-call db (the claim path's) still rides; the input is the
      // inbound turn verbatim plus the bound.
      expect(deps.db).toBe(turnDb)
      expect(input).toEqual({
        ...inbound,
        wallClock: { maxMs: loadEnv().VYNEL_INTERACTIVE_TURN_MAX_MS },
      })
    })

    it('honors a `turnMaxMs` override (the test knob) over the env default', async () => {
      runGlobalRootTurnMock.mockResolvedValue({ sessionId: 'sess-1', resultText: '' })
      const runRootTurn = await captureRunRootTurn({ ...fakeOptions(), turnMaxMs: 1_234 })
      await runRootTurn({} as unknown as Database, inbound)
      const input = runGlobalRootTurnMock.mock.calls[0]?.[1] as Record<string, unknown>
      expect(input.wallClock).toEqual({ maxMs: 1_234 })
    })

    it("a capped turn's typed failure surfaces to the channels leaf unchanged (its apology + failed row follow)", async () => {
      const capFailure = Object.assign(new Error('turn exceeded the 60-minute limit'), {
        errorCode: 'turn-wall-clock-exceeded',
      })
      runGlobalRootTurnMock.mockRejectedValue(capFailure)
      const runRootTurn = await captureRunRootTurn(fakeOptions())
      await expect(runRootTurn({} as unknown as Database, inbound)).rejects.toBe(capFailure)
    })
  })

  it('scrubs a processing failure through the logger without throwing', async () => {
    listPendingMock.mockReturnValue([{ id: 'in-1' }])
    processMock.mockRejectedValue(new Error('bot-token-1234:secret leaked'))
    const options = fakeOptions()
    const service = startChannelsService(options)

    await vi.advanceTimersByTimeAsync(1_000)
    // Let the rejected processInboundMessage promise settle into the .catch.
    await Promise.resolve()

    expect(options.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ inboundMessageId: 'in-1' }),
      'channel processing failed',
    )

    service.stop()
  })

  it('stop() halts all three loops', async () => {
    listPendingMock.mockReturnValue([{ id: 'in-1' }])
    const service = startChannelsService(fakeOptions())
    await vi.advanceTimersByTimeAsync(5_000)
    const pollCalls = pollMock.mock.calls.length
    const deliverCalls = deliverMock.mock.calls.length
    const processCalls = processMock.mock.calls.length
    service.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pollMock.mock.calls.length).toBe(pollCalls)
    expect(deliverMock.mock.calls.length).toBe(deliverCalls)
    expect(processMock.mock.calls.length).toBe(processCalls)
  })
})

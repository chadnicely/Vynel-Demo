// The two guards on the options a stream hands its lock (review fold):
// the announce may never escape `waitInLockQueue`, and a stream that was
// already aborted must give up instead of parking. Both are exercised against
// the REAL queue (`SessionTargetLocks.acquire` consumes these options and calls
// `waitInLockQueue`), because what is being pinned is the key not leaking —
// which only the real queue can show.

import { describe, it, expect, vi } from 'vitest'
import type { Logger } from 'pino'
import type { SSEStreamingApi } from 'hono/streaming'
import { LockWaitAbandonedError, LockWaitExpiredError } from '@vynel/session/runtime'
import { SessionTargetLocks } from '@vynel/session/delegation'
import { buildTurnLockWait } from './turn-queue-wait.js'

function recordingLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  return {
    warn,
    logger: { warn, debug: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Logger,
  }
}

/** The two members `buildTurnLockWait` touches, plus the write the announce makes. */
function fakeStream(aborted = false): SSEStreamingApi {
  return {
    aborted,
    onAbort: () => {},
    writeSSE: async () => {},
  } as unknown as SSEStreamingApi
}

const neverAborts = (): AbortSignal => new AbortController().signal

describe('buildTurnLockWait — the announce may not escape the queue', () => {
  it('a throwing reason still gives up on the BOUND and leaves the queue clean', async () => {
    const locks = new SessionTargetLocks()
    const { logger, warn } = recordingLogger()
    const releaseHolder = await locks.acquire('target-bound')

    const parked = locks.acquire(
      'target-bound',
      buildTurnLockWait({
        stream: fakeStream(),
        requestSignal: neverAborts(),
        maxWaitMs: 40,
        // The reason is resolved PER FRAME off live state, so it is the part
        // that can realistically throw. The first announce runs OUTSIDE
        // `waitInLockQueue`'s try: unguarded, this throw skipped `leaveQueue`
        // and the key stayed queued behind a holder forever.
        resolveReason: () => {
          throw new Error('the swap registry blew up')
        },
        logger,
      }),
    )

    await expect(parked).rejects.toBeInstanceOf(LockWaitExpiredError)
    expect(warn).toHaveBeenCalled()
    releaseHolder()
    expect(locks.isBusy('target-bound')).toBe(false)
  })

  it('a throwing reason still gives up on the CLIENT-GONE signal and leaves the queue clean', async () => {
    const locks = new SessionTargetLocks()
    const { logger } = recordingLogger()
    const clientGone = new AbortController()
    const releaseHolder = await locks.acquire('target-abort')

    const parked = locks.acquire(
      'target-abort',
      buildTurnLockWait({
        stream: fakeStream(),
        requestSignal: clientGone.signal,
        maxWaitMs: 60_000,
        resolveReason: () => {
          throw new Error('the swap registry blew up')
        },
        logger,
      }),
    )
    clientGone.abort()

    await expect(parked).rejects.toBeInstanceOf(LockWaitAbandonedError)
    releaseHolder()
    expect(locks.isBusy('target-abort')).toBe(false)
  })
})

describe('buildTurnLockWait — a stream that is ALREADY gone', () => {
  it('gives up at once instead of parking (onAbort never fires for it)', async () => {
    const locks = new SessionTargetLocks()
    const { logger } = recordingLogger()
    const releaseHolder = await locks.acquire('target-dead')

    // hono's `onAbort` only appends a subscriber — it never replays an abort
    // that already happened, so without the entry check this waiter would park
    // for its whole budget on behalf of a client that is provably gone.
    const wait = buildTurnLockWait({
      stream: fakeStream(true),
      requestSignal: neverAborts(),
      maxWaitMs: 60_000,
      resolveReason: () => 'busy',
      logger,
    })
    expect(wait.signal?.aborted).toBe(true)

    await expect(locks.acquire('target-dead', wait)).rejects.toBeInstanceOf(LockWaitAbandonedError)
    releaseHolder()
    expect(locks.isBusy('target-dead')).toBe(false)
  })
})

// The automatic continuation loop: one generator the runners wrap their turn
// in — the genuine turn, then a continuation per pending checkpoint (the
// runner re-resolves the head inside its `runTurn`), up to the runaway cap;
// a genuine turn drops a stale checkpoint. The events of every turn flow
// through the ONE stream, in order.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatTurnEvent } from '@vynel/chat'
import {
  MAX_CONSECUTIVE_CONTINUATIONS,
  clearPendingCheckpoint,
  markPendingCheckpoint,
  peekPendingCheckpoint,
} from '../continuity/pending-checkpoints.js'
import { runTurnWithContinuations } from './run-turn-with-continuations.js'
import type { ContinuationTurn } from './continuation-turn.js'

const PRIMARY = 'primary-continuations-loop-test'

afterEach(() => {
  clearPendingCheckpoint(PRIMARY)
})

async function drain(stream: AsyncIterable<ChatTurnEvent>): Promise<ChatTurnEvent[]> {
  const events: ChatTurnEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function turnEvents(label: string): ChatTurnEvent[] {
  return [
    { kind: 'text-chunk', messageId: `${label}-m`, textDelta: label },
    { kind: 'session-completed', sessionId: `${label}-s` },
  ]
}

describe('runTurnWithContinuations', () => {
  it('runs just the genuine turn when nothing was checkpointed', async () => {
    const runs: Array<ContinuationTurn | null> = []
    const events = await drain(
      runTurnWithContinuations({
        primarySessionId: PRIMARY,
        runTurn: async function* (continuation) {
          runs.push(continuation)
          yield* turnEvents('t1')
        },
      }),
    )
    expect(runs).toEqual([null])
    expect(events.map((event) => event.kind)).toEqual(['text-chunk', 'session-completed'])
  })

  it('continues after a checkpoint the turn left — the continuation carries the next step, in the same stream', async () => {
    const runs: Array<ContinuationTurn | null> = []
    const events = await drain(
      runTurnWithContinuations({
        primarySessionId: PRIMARY,
        runTurn: async function* (continuation) {
          runs.push(continuation)
          if (continuation === null) {
            // The model checkpointed mid-turn (the tool marks it), then ended.
            markPendingCheckpoint(PRIMARY, 'wire the DM stream')
            yield* turnEvents('t1')
            return
          }
          yield* turnEvents('t2')
        },
      }),
    )
    expect(runs).toHaveLength(2)
    expect(runs[1]?.checkpoint.nextStep).toBe('wire the DM stream')
    expect(runs[1]?.persistedBody).toBe('Continuing after patching context — next: wire the DM stream')
    expect(runs[1]?.providerText).toContain('NEXT STEP: wire the DM stream')
    expect(runs[1]?.attribution).toEqual({ userSourceKind: 'global-root' })
    // Both turns' events, in order, on the one stream.
    expect(events.map((event) => event.kind)).toEqual([
      'text-chunk',
      'session-completed',
      'text-chunk',
      'session-completed',
    ])
    // Consumed — nothing left pending.
    expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
  })

  it('keeps continuing while checkpoints keep coming, and stops at the runaway cap (logged)', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    let runs = 0
    await drain(
      runTurnWithContinuations({
        primarySessionId: PRIMARY,
        runTurn: async function* () {
          runs += 1
          // A model that checkpoints on EVERY turn.
          markPendingCheckpoint(PRIMARY, `again ${runs}`)
          yield* turnEvents(`t${runs}`)
        },
        logger: logger as never,
      }),
    )
    // The genuine turn + the capped number of continuations.
    expect(runs).toBe(1 + MAX_CONSECUTIVE_CONTINUATIONS)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ primarySessionId: PRIMARY }),
      expect.stringContaining('cap was reached'),
    )
    // The over-cap checkpoint was taken and dropped — the next real message drives.
    expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
  })

  it('never continues a turn the user STOPPED or that FAILED — the checkpoint is dropped, nothing restarts', async () => {
    for (const terminal of [
      { kind: 'session-interrupted', sessionId: 't1-s' } as const,
      { kind: 'session-errored', sessionId: 't1-s', errorCode: 'engine-died', errorMessage: 'gone', isRecoverable: false } as const,
    ]) {
      const logger = { warn: vi.fn(), info: vi.fn() }
      const runs: Array<ContinuationTurn | null> = []
      await drain(
        runTurnWithContinuations({
          primarySessionId: PRIMARY,
          runTurn: async function* (continuation) {
            runs.push(continuation)
            // The model checkpointed, kept working, and the turn ended badly.
            markPendingCheckpoint(PRIMARY, 'would restart the halted work')
            yield { kind: 'text-chunk', messageId: 'm', textDelta: 'working…' }
            yield terminal
          },
          logger: logger as never,
        }),
      )
      expect(runs).toEqual([null])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ nextStep: 'would restart the halted work' }),
        expect.stringContaining('did not complete'),
      )
      expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
      clearPendingCheckpoint(PRIMARY)
    }
  })

  it('a recoverable error followed by completion is a completed turn — it continues', async () => {
    const runs: Array<ContinuationTurn | null> = []
    await drain(
      runTurnWithContinuations({
        primarySessionId: PRIMARY,
        runTurn: async function* (continuation) {
          runs.push(continuation)
          if (continuation === null) {
            markPendingCheckpoint(PRIMARY, 'carry on')
            yield { kind: 'session-errored', sessionId: 't1-s', errorCode: 'blip', errorMessage: 'retrying', isRecoverable: true }
          }
          yield* turnEvents(continuation === null ? 't1' : 't2')
        },
      }),
    )
    expect(runs).toHaveLength(2)
  })

  it('autoContinue: false (a delivery turn) runs the genuine turn only and drops a stray checkpoint', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const runs: Array<ContinuationTurn | null> = []
    await drain(
      runTurnWithContinuations({
        primarySessionId: PRIMARY,
        autoContinue: false,
        runTurn: async function* (continuation) {
          runs.push(continuation)
          markPendingCheckpoint(PRIMARY, 'a delivery never continues')
          yield* turnEvents('t1')
        },
        logger: logger as never,
      }),
    )
    expect(runs).toEqual([null])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextStep: 'a delivery never continues' }),
      expect.stringContaining('never continues'),
    )
    expect(peekPendingCheckpoint(PRIMARY)).toBeNull()
  })

  it('a genuine turn drops a stale checkpoint left by an earlier turn instead of continuing it', async () => {
    markPendingCheckpoint(PRIMARY, 'left behind')
    const logger = { warn: vi.fn(), info: vi.fn() }
    const runs: Array<ContinuationTurn | null> = []
    await drain(
      runTurnWithContinuations({
        primarySessionId: PRIMARY,
        runTurn: async function* (continuation) {
          runs.push(continuation)
          yield* turnEvents('t1')
        },
        logger: logger as never,
      }),
    )
    expect(runs).toEqual([null])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nextStep: 'left behind' }),
      expect.stringContaining('stale checkpoint dropped'),
    )
  })
})

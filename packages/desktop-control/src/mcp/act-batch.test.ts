import { describe, it, expect } from 'vitest'
import { buildBatchResponse, runActionBatch, type BatchStepResult } from './act-batch.js'

const ok = (detail: string): BatchStepResult => ({ ok: true, detail })

// The response content is McpToolContent[] since observe screenshots can ride
// it — narrow the first block back to its text for the assertions here.
const firstText = (response: { content: Array<{ type: string }> }): string => {
  const first = response.content[0]
  return first !== undefined && 'text' in first ? String((first as { text: unknown }).text) : ''
}

describe('runActionBatch', () => {
  it('runs every step in order when all succeed', async () => {
    const ran: number[] = []
    const outcome = await runActionBatch([1, 2, 3], async (item) => {
      ran.push(item)
      return ok(`did ${item}`)
    })
    expect(ran).toEqual([1, 2, 3])
    expect(outcome.failedAt).toBeNull()
    expect(outcome.skipped).toBe(0)
    expect(outcome.results).toHaveLength(3)
  })

  it('STOPS at the first failure and never runs the rest', async () => {
    // The desktop is stateful — a step after a failed one would act on a
    // screen the model never saw.
    const ran: number[] = []
    const outcome = await runActionBatch([1, 2, 3, 4], async (item) => {
      ran.push(item)
      return item === 2 ? { ok: false, detail: 'selector matched 3 elements' } : ok(`did ${item}`)
    })
    expect(ran).toEqual([1, 2])
    expect(outcome.failedAt).toBe(1)
    expect(outcome.skipped).toBe(2)
    expect(outcome.results).toHaveLength(2)
  })

  it('converts a thrown step into a stop, keeping earlier results', async () => {
    const outcome = await runActionBatch([1, 2, 3], async (item) => {
      if (item === 2) throw new Error('Desktop access denied for "Discord"')
      return ok(`did ${item}`)
    })
    expect(outcome.failedAt).toBe(1)
    expect(outcome.results[0]?.detail).toBe('did 1')
    expect(outcome.results[1]?.detail).toContain('Desktop access denied')
  })

  it('passes the step index through', async () => {
    const seen: number[] = []
    await runActionBatch(['a', 'b'], async (_item, index) => {
      seen.push(index)
      return ok('x')
    })
    expect(seen).toEqual([0, 1])
  })

  it('runs betweenSteps BETWEEN successful steps — never after the last', async () => {
    // This seam is what puts back the settle the model round-trip used to
    // provide between separate calls; a trailing call would just add latency.
    const order: string[] = []
    await runActionBatch(
      ['a', 'b', 'c'],
      async (item) => {
        order.push(`run:${item}`)
        return ok(item)
      },
      {
        betweenSteps: async (justRan) => {
          order.push(`settle:${justRan}`)
        },
      },
    )
    expect(order).toEqual(['run:a', 'settle:a', 'run:b', 'settle:b', 'run:c'])
  })

  it('does not settle after a FAILED step (the batch is over)', async () => {
    const order: string[] = []
    await runActionBatch(
      ['a', 'b'],
      async (item) => {
        order.push(`run:${item}`)
        return item === 'a' ? { ok: false, detail: 'denied' } : ok(item)
      },
      {
        betweenSteps: async (justRan) => {
          order.push(`settle:${justRan}`)
        },
      },
    )
    expect(order).toEqual(['run:a'])
  })
})

describe('buildBatchResponse', () => {
  it('reports a full run as a numbered log, not an error', () => {
    const response = buildBatchResponse({
      results: [ok('clicked the box'), ok('typed "hello"')],
      failedAt: null,
      skipped: 0,
    })
    expect(response.isError).toBeUndefined()
    const text = firstText(response)
    expect(text).toContain('All 2 actions ran')
    expect(text).toContain('1. OK — clicked the box')
    expect(text).toContain('2. OK — typed "hello"')
  })

  it('names the stopping step, what did not run, and the re-observe path', () => {
    const response = buildBatchResponse({
      results: [ok('clicked the box'), { ok: false, detail: 'no such element' }],
      failedAt: 1,
      skipped: 2,
    })
    expect(response.isError).toBe(true)
    const text = firstText(response)
    expect(text).toContain('Stopped at action 2')
    expect(text).toContain('remaining 2 actions did NOT run')
    expect(text).toContain('snapshot_app')
    // The successful step stays visible — the model must know what DID happen.
    expect(text).toContain('1. OK — clicked the box')
    expect(text).toContain('2. STOPPED — no such element')
  })

  it('singularizes a lone skipped action', () => {
    const text = firstText(
      buildBatchResponse({
        results: [{ ok: false, detail: 'denied' }],
        failedAt: 0,
        skipped: 1,
      }),
    )
    expect(text).toContain('remaining 1 action did NOT run')
  })

  it('omits the skip note when the LAST action was the one that failed', () => {
    const text = firstText(
      buildBatchResponse({
        results: [ok('a'), { ok: false, detail: 'denied' }],
        failedAt: 1,
        skipped: 0,
      }),
    )
    expect(text).not.toContain('did NOT run')
    expect(text).toContain('Stopped at action 2')
  })
})

// The wall-clock bound (2026-08-11). The user's Stop aborts the model loop, not
// an in-flight tool handler, so a running batch is un-interruptible — at 20
// actions x a 15s per-action bound that is minutes of clicking after the user
// asked it to stop. The MCP request's AbortSignal is NOT a usable fix: the
// handler receives one, but cancelling the call rejects only the caller's
// promise while the handler runs to completion (measured against the shipped
// SDK). Time is the honest bound.
describe('runActionBatch — the wall-clock bound', () => {
  /** A clock the test advances by hand, so no test ever waits in real time. */
  function fakeClock(startAt = 1_000) {
    let current = startAt
    return { now: () => current, advance: (ms: number) => (current += ms) }
  }

  const ok = (detail: string) => ({ ok: true, detail })

  it('runs a normal batch to completion — an ordinary batch never sees the bound', async () => {
    const clock = fakeClock()
    const outcome = await runActionBatch(
      ['a', 'b', 'c'],
      async (item) => {
        clock.advance(200)
        return ok(item)
      },
      { now: clock.now, wallClockMs: 45_000 },
    )
    expect(outcome.failedAt).toBeNull()
    expect(outcome.stopReason).toBeUndefined()
    expect(outcome.results).toHaveLength(3)
  })

  it('stops BETWEEN steps once the budget is spent, and never runs the rest', async () => {
    const clock = fakeClock()
    const ran: string[] = []
    const outcome = await runActionBatch(
      ['a', 'b', 'c', 'd'],
      async (item) => {
        ran.push(item)
        clock.advance(400) // two steps spend the 600ms budget
        return ok(item)
      },
      { now: clock.now, wallClockMs: 600 },
    )
    expect(ran).toEqual(['a', 'b'])
    expect(outcome.stopReason).toBe('deadline')
    expect(outcome.results).toHaveLength(2)
    expect(outcome.skipped).toBe(2)
    // Nothing FAILED — naming a successful step as the culprit would blame work
    // that was fine.
    expect(outcome.failedAt).toBeNull()
  })

  it('never interrupts a step that is already running', async () => {
    // A step abandoned mid-keystroke leaves a half-typed field nobody planned
    // for — worse than finishing it. One very long step still completes.
    const clock = fakeClock()
    const outcome = await runActionBatch(
      ['slow', 'next'],
      async (item) => {
        clock.advance(99_000)
        return ok(item)
      },
      { now: clock.now, wallClockMs: 1_000 },
    )
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]).toEqual(ok('slow'))
    expect(outcome.stopReason).toBe('deadline')
  })

  it('always runs the FIRST step, however small the budget', async () => {
    // A batch that did nothing at all would report a stop with no cause the
    // user could have seen.
    const clock = fakeClock()
    const outcome = await runActionBatch(
      ['only'],
      async (item) => {
        clock.advance(10_000)
        return ok(item)
      },
      { now: clock.now, wallClockMs: 0 },
    )
    expect(outcome.results).toHaveLength(1)
    expect(outcome.failedAt).toBeNull()
  })

  it('a real failure still reports as a failure, not a deadline', async () => {
    const outcome = await runActionBatch(['a', 'b'], async (item) =>
      item === 'a' ? ok(item) : { ok: false, detail: 'boom' },
    )
    expect(outcome.stopReason).toBe('step-failed')
    expect(outcome.failedAt).toBe(1)
  })
})

describe('buildBatchResponse — a deadline reads differently from a failure', () => {
  // `failedAt` is null on a deadline (nothing failed), so this branch MUST be
  // tested before the all-ran one — otherwise a cut-off batch reports as a
  // complete one and the model carries on believing every step ran.
  it('does NOT blame a step when the batch merely ran out of time', async () => {
    const response = buildBatchResponse({
      results: [{ ok: true, detail: 'clicked' }, { ok: true, detail: 'typed' }],
      failedAt: null,
      skipped: 3,
      stopReason: 'deadline',
    })
    const text = firstText(response)
    // Saying "stopped at action 2" would send the model hunting for a fault in
    // a step that worked perfectly.
    expect(text).not.toMatch(/Stopped at action/)
    expect(text).toMatch(/time limit/i)
    expect(text).toMatch(/all of which succeeded/i)
    expect(text).toMatch(/3 actions did NOT run/)
    expect(response.isError).toBe(true)
  })

  it('still blames the step when one actually failed', async () => {
    const response = buildBatchResponse({
      results: [{ ok: true, detail: 'clicked' }, { ok: false, detail: 'no such element' }],
      failedAt: 1,
      skipped: 0,
      stopReason: 'step-failed',
    })
    expect(firstText(response)).toMatch(/Stopped at action 2/)
  })
})

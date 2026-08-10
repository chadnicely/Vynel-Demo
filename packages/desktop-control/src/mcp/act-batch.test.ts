import { describe, it, expect } from 'vitest'
import { buildBatchResponse, runActionBatch, type BatchStepResult } from './act-batch.js'

const ok = (detail: string): BatchStepResult => ({ ok: true, detail })

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
    const text = response.content[0]?.text ?? ''
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
    const text = response.content[0]?.text ?? ''
    expect(text).toContain('Stopped at action 2')
    expect(text).toContain('remaining 2 actions did NOT run')
    expect(text).toContain('snapshot_app')
    // The successful step stays visible — the model must know what DID happen.
    expect(text).toContain('1. OK — clicked the box')
    expect(text).toContain('2. STOPPED — no such element')
  })

  it('singularizes a lone skipped action', () => {
    const text =
      buildBatchResponse({
        results: [{ ok: false, detail: 'denied' }],
        failedAt: 0,
        skipped: 1,
      }).content[0]?.text ?? ''
    expect(text).toContain('remaining 1 action did NOT run')
  })

  it('omits the skip note when the LAST action was the one that failed', () => {
    const text =
      buildBatchResponse({
        results: [ok('a'), { ok: false, detail: 'denied' }],
        failedAt: 1,
        skipped: 0,
      }).content[0]?.text ?? ''
    expect(text).not.toContain('did NOT run')
    expect(text).toContain('Stopped at action 2')
  })
})

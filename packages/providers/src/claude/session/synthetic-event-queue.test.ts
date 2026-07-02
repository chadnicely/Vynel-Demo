// Tests for `SyntheticEventQueue` — enqueue-while-waiting, buffer-then-dequeue,
// FIFO ordering, close-as-no-op.
// See `docs/blueprints/providers/blueprint.md §17.4`.

import { describe, expect, it } from 'vitest'
import { SyntheticEventQueue } from './synthetic-event-queue.js'

describe('SyntheticEventQueue', () => {
  it('enqueue then dequeue returns the enqueued value', async () => {
    const queue = new SyntheticEventQueue<string>()
    queue.enqueue('event-1')
    expect(await queue.dequeue()).toBe('event-1')
  })

  it('dequeue on an empty queue waits; a later enqueue resolves it', async () => {
    const queue = new SyntheticEventQueue<string>()
    const pending = queue.dequeue()
    queue.enqueue('late')
    expect(await pending).toBe('late')
  })

  it('multiple events dequeue FIFO', async () => {
    const queue = new SyntheticEventQueue<string>()
    queue.enqueue('a')
    queue.enqueue('b')
    queue.enqueue('c')
    expect(await queue.dequeue()).toBe('a')
    expect(await queue.dequeue()).toBe('b')
    expect(await queue.dequeue()).toBe('c')
  })

  it('isEmpty reflects buffered events', async () => {
    const queue = new SyntheticEventQueue<string>()
    expect(queue.isEmpty()).toBe(true)
    queue.enqueue('x')
    expect(queue.isEmpty()).toBe(false)
    await queue.dequeue()
    expect(queue.isEmpty()).toBe(true)
  })

  it('close makes a subsequent enqueue a no-op', () => {
    const queue = new SyntheticEventQueue<string>()
    queue.close()
    queue.enqueue('dropped')
    expect(queue.isEmpty()).toBe(true)
  })
})

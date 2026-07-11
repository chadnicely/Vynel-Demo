import { describe, expect, it, vi } from 'vitest'
import type { ChatTurnEvent } from '@vynel/chat'
import { TurnEventBroadcaster } from './turn-event-broadcaster.js'

const textChunk = (delta: string): ChatTurnEvent => ({
  kind: 'text-chunk',
  messageId: 'm1',
  textDelta: delta,
})

describe('TurnEventBroadcaster', () => {
  it('fans events out to subscribers from attach-time on, and end() closes + detaches', () => {
    const broadcaster = new TurnEventBroadcaster()
    const seen: string[] = []
    const ended = vi.fn()

    broadcaster.publish('trace:t1', textChunk('missed')) // nobody attached yet — dropped
    broadcaster.subscribe('trace:t1', {
      onEvent: (event) => seen.push(event.kind === 'text-chunk' ? event.textDelta : event.kind),
      onEnd: ended,
    })
    broadcaster.publish('trace:t1', textChunk('a'))
    broadcaster.publish('trace:t2', textChunk('other-channel'))
    broadcaster.end('trace:t1')
    broadcaster.publish('trace:t1', textChunk('after-end')) // channel gone — dropped

    expect(seen).toEqual(['a'])
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe detaches without affecting other subscribers', () => {
    const broadcaster = new TurnEventBroadcaster()
    const first: string[] = []
    const second: string[] = []
    const unsubscribeFirst = broadcaster.subscribe('trace:t1', {
      onEvent: () => first.push('x'),
      onEnd: () => {},
    })
    broadcaster.subscribe('trace:t1', {
      onEvent: () => second.push('x'),
      onEnd: () => {},
    })

    broadcaster.publish('trace:t1', textChunk('a'))
    unsubscribeFirst()
    unsubscribeFirst() // idempotent
    broadcaster.publish('trace:t1', textChunk('b'))

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
  })

  it('contains a throwing observer — detached, the publish continues', () => {
    const broadcaster = new TurnEventBroadcaster()
    const healthy: string[] = []
    broadcaster.subscribe('trace:t1', {
      onEvent: () => {
        throw new Error('broken observer')
      },
      onEnd: () => {},
    })
    broadcaster.subscribe('trace:t1', {
      onEvent: () => healthy.push('x'),
      onEnd: () => {},
    })

    expect(() => broadcaster.publish('trace:t1', textChunk('a'))).not.toThrow()
    broadcaster.publish('trace:t1', textChunk('b'))
    expect(healthy).toHaveLength(2)
  })
})

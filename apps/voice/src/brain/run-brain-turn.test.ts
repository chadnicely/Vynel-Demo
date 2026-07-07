import { describe, expect, it } from 'vitest'
import { mapFrameToBrainEvent } from './run-brain-turn.js'

describe('mapFrameToBrainEvent', () => {
  it('maps a text-chunk to a text event', () => {
    expect(
      mapFrameToBrainEvent({ event: 'text-chunk', data: '{"kind":"text-chunk","textDelta":"hello"}' }),
    ).toEqual({ kind: 'text', delta: 'hello' })
  })

  it('maps the terminal frame to completed', () => {
    expect(mapFrameToBrainEvent({ event: 'turn-stream-ended', data: '{}' })).toEqual({
      kind: 'completed',
    })
  })

  it('maps session-errored to a failure with the message', () => {
    expect(
      mapFrameToBrainEvent({
        event: 'session-errored',
        data: '{"kind":"session-errored","errorMessage":"boom"}',
      }),
    ).toEqual({ kind: 'failed', message: 'boom' })
  })

  it('ignores frames voice does not speak (thinking, tool calls)', () => {
    expect(
      mapFrameToBrainEvent({ event: 'thinking-chunk', data: '{"kind":"thinking-chunk"}' }),
    ).toBeNull()
    expect(
      mapFrameToBrainEvent({ event: 'tool-call-started', data: '{"kind":"tool-call-started"}' }),
    ).toBeNull()
  })

  it('ignores malformed data', () => {
    expect(mapFrameToBrainEvent({ event: 'text-chunk', data: 'not json' })).toBeNull()
  })
})

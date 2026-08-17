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

  it("maps session-completed to completed — the answer is done there; the boundary swap frames after it are not voice's to wait on", () => {
    expect(
      mapFrameToBrainEvent({ event: 'session-completed', data: '{"kind":"session-completed","sessionId":"s"}' }),
    ).toEqual({ kind: 'completed' })
    expect(
      mapFrameToBrainEvent({ event: 'context-patching', data: '{"kind":"context-patching","sessionId":"s","primarySessionId":"p"}' }),
    ).toBeNull()
    expect(
      mapFrameToBrainEvent({ event: 'context-patched', data: '{"kind":"context-patched","sessionId":"s","primarySessionId":"p","toSessionId":"t"}' }),
    ).toBeNull()
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

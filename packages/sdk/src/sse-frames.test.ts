import { describe, expect, it } from 'vitest'
import { parseSseFrames } from './sse-frames.js'

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder()
  for (const part of parts) yield encoder.encode(part)
}

async function collect(stream: AsyncIterable<Uint8Array>) {
  const frames = []
  for await (const frame of parseSseFrames(stream)) frames.push(frame)
  return frames
}

describe('parseSseFrames', () => {
  it('parses event + data frames', async () => {
    const frames = await collect(
      chunks('event: text-chunk\ndata: {"kind":"text-chunk","textDelta":"hi"}\n\n'),
    )
    expect(frames).toEqual([
      { event: 'text-chunk', data: '{"kind":"text-chunk","textDelta":"hi"}' },
    ])
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    const frames = await collect(chunks('event: text-ch', 'unk\ndata: {"a":1}', '\n\nevent: turn-stream-ended\ndata: {}\n\n'))
    expect(frames).toEqual([
      { event: 'text-chunk', data: '{"a":1}' },
      { event: 'turn-stream-ended', data: '{}' },
    ])
  })

  it('ignores blank keep-alive separators', async () => {
    const frames = await collect(chunks('\n\ndata: {"x":1}\n\n'))
    expect(frames).toEqual([{ event: 'message', data: '{"x":1}' }])
  })
})

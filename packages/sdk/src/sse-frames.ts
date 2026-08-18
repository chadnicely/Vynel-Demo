// A minimal Server-Sent-Events frame parser: turns a byte stream into
// `{ event, data }` frames. Hono's `streamSSE` writes `event: <kind>\n
// data: <json>\n\n` per frame; this splits on the blank-line separator and
// tolerates a frame straddling chunk boundaries. Pure + unit-tested. The ONE
// home for every Node-side SSE consumer (the voice daemon's brain client, the
// api's voice-daemon relay); the web app carries its own browser-side reader.

export interface SseFrame {
  readonly event: string
  readonly data: string
}

export async function* parseSseFrames(
  stream: AsyncIterable<Uint8Array>,
): AsyncIterable<SseFrame> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    let separator = buffer.indexOf('\n\n')
    while (separator !== -1) {
      const frame = parseFrame(buffer.slice(0, separator))
      buffer = buffer.slice(separator + 2)
      if (frame !== null) yield frame
      separator = buffer.indexOf('\n\n')
    }
  }
  const trailing = parseFrame(buffer)
  if (trailing !== null) yield trailing
}

function parseFrame(raw: string): SseFrame | null {
  if (raw.trim() === '') return null
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
  }
  return { event, data: dataLines.join('\n') }
}

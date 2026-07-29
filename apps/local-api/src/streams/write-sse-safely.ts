// Best-effort SSE write for terminal frames — the error/ended frames fire on
// EVERY exit path, including after a client disconnect or a mid-write failure,
// where a throw here would mask the error that actually ended the turn.

import type { SSEStreamingApi } from 'hono/streaming'
import type { Logger } from 'pino'

export async function writeSseSafely(
  stream: SSEStreamingApi,
  event: string,
  jsonData: string,
  logger: Logger,
): Promise<void> {
  try {
    await stream.writeSSE({ event, data: jsonData })
  } catch (err) {
    logger.debug({ err, event }, 'terminal SSE frame write failed (client likely gone)')
  }
}

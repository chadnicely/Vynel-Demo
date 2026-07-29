// The session-keyed live turn channel (session-library Slice ③ — Watch
// everywhere). Every turn runner tees its ChatTurnEvents through here onto
// the shared TurnEventBroadcaster under `session:<id>`, so ANY session can be
// observed live the way delegation traces are — publishing to a channel with
// no subscribers is a no-op, so an unwatched turn costs nothing. The
// delegation trace channel (keyed by the JOB's partialSessionId) stays — the
// stop path anchors on it; a delegated turn publishes to BOTH keys.

import type { ChatTurnEvent } from '@vynel/chat'
import type { TurnEventBroadcaster } from '../delegation/turn-event-broadcaster.js'

export function sessionChannelKey(sessionId: string): string {
  return `session:${sessionId}`
}

// The id lives top-level on the lifecycle events and nested on the two
// earliest frames — `user-message-persisted` is EVERY turn's first event
// (fresh and resumed alike), so the channel keys from frame one.
function sessionIdOf(event: ChatTurnEvent): string | null {
  // Non-empty only: a pre-session `session-errored` carries sessionId '' — the
  // one-shot key resolution below would otherwise lock the whole turn onto the
  // garbage 'session:' channel and no watcher would ever see it.
  if ('sessionId' in event && typeof event.sessionId === 'string' && event.sessionId !== '') {
    return event.sessionId
  }
  if (event.kind === 'user-message-persisted') return event.message.sessionId
  if (event.kind === 'session-created') return event.session.id
  return null
}

/** Tee a turn's events onto its session channel. Ends the channel when the
 *  stream ends — drained, thrown, or abandoned alike (the finally). */
export async function* publishTurnEventsToSessionChannel(
  turnStream: AsyncIterable<ChatTurnEvent>,
  turnEvents: TurnEventBroadcaster,
): AsyncIterable<ChatTurnEvent> {
  let channelKey: string | null = null
  try {
    for await (const event of turnStream) {
      if (channelKey === null) {
        const sessionId = sessionIdOf(event)
        if (sessionId !== null) channelKey = sessionChannelKey(sessionId)
      }
      if (channelKey !== null) turnEvents.publish(channelKey, event)
      yield event
    }
  } finally {
    if (channelKey !== null) turnEvents.end(channelKey)
  }
}

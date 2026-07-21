// Tests for the session-keyed live turn channel (Watch everywhere, Slice ③).

import { describe, expect, it } from 'vitest'
import type { ChatTurnEvent } from '@vynel/chat'
import type { ChatMessage, ChatSession } from '@vynel/chat'
import { TurnEventBroadcaster } from '../delegation/turn-event-broadcaster.js'
import {
  publishTurnEventsToSessionChannel,
  sessionChannelKey,
} from './session-turn-channel.js'

function userMessagePersisted(sessionId: string): ChatTurnEvent {
  return {
    kind: 'user-message-persisted',
    message: { id: 'msg-user', sessionId } as ChatMessage,
  }
}

async function* eventsFrom(events: ChatTurnEvent[]): AsyncIterable<ChatTurnEvent> {
  for (const event of events) yield event
}

describe('publishTurnEventsToSessionChannel', () => {
  it('keys from the FIRST frame (user-message-persisted), publishes every event, ends on drain', async () => {
    const turnEvents = new TurnEventBroadcaster()
    const seen: string[] = []
    let ended = false
    turnEvents.subscribe(sessionChannelKey('sdk-1'), {
      onEvent: (event) => seen.push(event.kind),
      onEnd: () => {
        ended = true
      },
    })

    const out: string[] = []
    for await (const event of publishTurnEventsToSessionChannel(
      eventsFrom([
        userMessagePersisted('sdk-1'),
        { kind: 'text-chunk', messageId: 'm1', textDelta: 'hi' },
        { kind: 'session-completed', sessionId: 'sdk-1' },
      ]),
      turnEvents,
    )) {
      out.push(event.kind)
    }

    // Transparent pass-through + full publication + channel end.
    expect(out).toEqual(['user-message-persisted', 'text-chunk', 'session-completed'])
    expect(seen).toEqual(['user-message-persisted', 'text-chunk', 'session-completed'])
    expect(ended).toBe(true)
  })

  it('ends the channel when iteration is ABANDONED mid-stream (client disconnect)', async () => {
    const turnEvents = new TurnEventBroadcaster()
    let ended = false
    turnEvents.subscribe(sessionChannelKey('sdk-2'), {
      onEvent: () => {},
      onEnd: () => {
        ended = true
      },
    })

    const stream = publishTurnEventsToSessionChannel(
      eventsFrom([
        userMessagePersisted('sdk-2'),
        { kind: 'text-chunk', messageId: 'm1', textDelta: 'hi' },
      ]),
      turnEvents,
    )
    for await (const event of stream) {
      if (event.kind === 'user-message-persisted') break
    }

    expect(ended).toBe(true)
  })

  it('keys from session-created when it is the first identifying frame', async () => {
    const turnEvents = new TurnEventBroadcaster()
    const seen: string[] = []
    turnEvents.subscribe(sessionChannelKey('sdk-3'), {
      onEvent: (event) => seen.push(event.kind),
      onEnd: () => {},
    })

    for await (const _event of publishTurnEventsToSessionChannel(
      eventsFrom([
        { kind: 'session-created', session: { id: 'sdk-3' } as ChatSession },
        { kind: 'text-chunk', messageId: 'm1', textDelta: 'x' },
      ]),
      turnEvents,
    )) {
      // drain
    }

    expect(seen).toEqual(['session-created', 'text-chunk'])
  })
})

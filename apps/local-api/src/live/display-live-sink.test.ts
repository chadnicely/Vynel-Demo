// The adapter between the Display leaf's structural sink and the live-channel
// hub: the right user's windows, nobody else's, and never a throw back into
// the op whose write has already committed.

import { describe, expect, it } from 'vitest'
import type { DisplayLiveFrame } from '@vynel/contracts/display/display-live'
import { LiveChannelHub, SessionActivityFeed } from '@vynel/session/runtime'
import { TurnEventBroadcaster } from '@vynel/session/delegation'
import type { LiveChannelOutboundFrame } from '@vynel/session/runtime'
import { createHubDisplayLiveSink } from './display-live-sink.js'

const OWNER = 'user-owner'
const STRANGER = 'user-stranger'

const removed: DisplayLiveFrame = { kind: 'removed', widgetId: 'w-1', scopeKey: 'ws-7' }

function fakeTransport() {
  const frames: LiveChannelOutboundFrame[] = []
  return {
    frames,
    take: () => frames.splice(0),
    transport: {
      send: (frame: LiveChannelOutboundFrame) => {
        frames.push(frame)
      },
      close: () => {},
    },
  }
}

function buildHub() {
  return new LiveChannelHub({
    turnEvents: new TurnEventBroadcaster(),
    activityFeed: new SessionActivityFeed(),
    authorizeChannel: () => true,
  })
}

const subscribeToDisplay = JSON.stringify({ op: 'subscribe', channels: ['display'] })

describe('createHubDisplayLiveSink', () => {
  it('delivers to the publishing user’s subscribed windows only', () => {
    const hub = buildHub()
    const sink = createHubDisplayLiveSink(hub)
    const ownerWindow = fakeTransport()
    const strangerWindow = fakeTransport()
    hub
      .connect({ userId: OWNER, transport: ownerWindow.transport })
      .handleMessage(subscribeToDisplay)
    hub
      .connect({ userId: STRANGER, transport: strangerWindow.transport })
      .handleMessage(subscribeToDisplay)
    ownerWindow.take()
    strangerWindow.take()

    sink.publish(OWNER, removed)

    expect(ownerWindow.take()).toEqual([{ kind: 'event', channel: 'display', event: removed }])
    expect(strangerWindow.take()).toEqual([])
    hub.dispose()
  })

  it('is a silent no-op when nobody is watching — the op’s write is already durable', () => {
    const hub = buildHub()
    const sink = createHubDisplayLiveSink(hub)
    const unsubscribed = fakeTransport()
    hub.connect({ userId: OWNER, transport: unsubscribed.transport })
    unsubscribed.take()

    expect(() => sink.publish(OWNER, removed)).not.toThrow()
    expect(() => sink.publish('nobody-at-all', removed)).not.toThrow()
    expect(unsubscribed.take()).toEqual([])
    hub.dispose()
  })
})

// The adapter between the voice route and the live-channel hub: one window's
// news reaches the rest of that user's voice windows, and nobody else's.

import { describe, expect, it } from 'vitest'
import { LiveChannelHub, SessionActivityFeed } from '@vynel/session/runtime'
import { TurnEventBroadcaster } from '@vynel/session/delegation'
import type { LiveChannelOutboundFrame } from '@vynel/session/runtime'
import { createHubVoiceControlSink } from './voice-control-sink.js'

const OWNER = 'user-owner'
const STRANGER = 'user-stranger'

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
    // The relay is irrelevant here — the frame is the api's own, not the daemon's.
    voice: { subscribe: () => () => {} },
  })
}

const subscribeToDock = JSON.stringify({ op: 'subscribe', channels: ['voice:dock:wake'] })

describe('createHubVoiceControlSink', () => {
  it('delivers to the publishing user’s voice windows only', () => {
    const hub = buildHub()
    const sink = createHubVoiceControlSink(hub)
    const ownerDock = fakeTransport()
    const strangerDock = fakeTransport()
    hub.connect({ userId: OWNER, transport: ownerDock.transport }).handleMessage(subscribeToDock)
    hub.connect({ userId: STRANGER, transport: strangerDock.transport }).handleMessage(subscribeToDock)
    ownerDock.take()
    strangerDock.take()

    sink.publish(OWNER, { kind: 'display-active', active: true })

    expect(ownerDock.take()).toEqual([
      {
        kind: 'event',
        channel: 'voice:dock:wake',
        event: { kind: 'display-active', active: true },
      },
    ])
    expect(strangerDock.take()).toEqual([])
    hub.dispose()
  })

  // The mirror frame rides the same seam — the sink knows only "one window's
  // news", never which of the two facts it carries.
  it('carries the room’s live conversation over the same path', () => {
    const hub = buildHub()
    const sink = createHubVoiceControlSink(hub)
    const ownerDock = fakeTransport()
    hub.connect({ userId: OWNER, transport: ownerDock.transport }).handleMessage(subscribeToDock)
    ownerDock.take()

    sink.publish(OWNER, {
      kind: 'display-session',
      live: true,
      phase: 'listening',
      caption: 'Listening…',
    })

    expect(ownerDock.take()).toEqual([
      {
        kind: 'event',
        channel: 'voice:dock:wake',
        event: { kind: 'display-session', live: true, phase: 'listening', caption: 'Listening…' },
      },
    ])
    hub.dispose()
  })

  it('never throws back at the window that spoke, however broken the listener is', () => {
    const hub = buildHub()
    const sink = createHubVoiceControlSink(hub)
    const broken = fakeTransport()
    hub.connect({ userId: OWNER, transport: broken.transport }).handleMessage(subscribeToDock)
    broken.transport.send = () => {
      throw new Error('socket gone')
    }

    expect(() => sink.publish(OWNER, { kind: 'display-active', active: false })).not.toThrow()
    hub.dispose()
  })
})

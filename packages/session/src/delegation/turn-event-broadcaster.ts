// `TurnEventBroadcaster` — the in-process pub/sub between a BACKGROUND turn's
// consume loop (the delegation tick's routed turn) and live OBSERVERS (the SSE
// observe routes). The producer publishes every `ChatTurnEvent` it drives and
// calls `end` when the turn's stream drains; each subscriber receives the events
// from attach-time on (no replay — the rows already persist live, so an observer
// fetches the settled state once and streams the tail).
//
// Phase 1 runs everything in ONE api process (the delegation service is
// in-process by design), so a Map of listener sets is the whole transport; the
// Phase-2 multi-process swap point is the reserved `pubsub` package. Genuinely
// stateful — the provider-registry class exception.

import type { ChatTurnEvent } from '@vynel/chat'

/** The channel a delegation's live turn publishes on — keyed by its trace key
 *  (the producer and the observe route derive it from this one home). */
export function traceChannelKey(partialSessionId: string): string {
  return `trace:${partialSessionId}`
}

export interface TurnEventSubscriber {
  onEvent: (event: ChatTurnEvent) => void
  /** The producer's turn finished (drained OR threw) — the observe stream closes. */
  onEnd: () => void
}

export class TurnEventBroadcaster {
  private readonly channels = new Map<string, Set<TurnEventSubscriber>>()

  /** Attach to a channel. Returns the unsubscribe (idempotent — call on abort). */
  subscribe(channelKey: string, subscriber: TurnEventSubscriber): () => void {
    const existing = this.channels.get(channelKey)
    if (existing !== undefined) {
      existing.add(subscriber)
    } else {
      this.channels.set(channelKey, new Set([subscriber]))
    }
    return () => {
      const subscribers = this.channels.get(channelKey)
      if (subscribers === undefined) return
      subscribers.delete(subscriber)
      if (subscribers.size === 0) this.channels.delete(channelKey)
    }
  }

  /** Fan an event out to the channel's current subscribers. A listener throw is
   *  contained — one broken observer must never break the producing turn. */
  publish(channelKey: string, event: ChatTurnEvent): void {
    const subscribers = this.channels.get(channelKey)
    if (subscribers === undefined) return
    for (const subscriber of subscribers) {
      try {
        subscriber.onEvent(event)
      } catch {
        subscribers.delete(subscriber) // a throwing observer is detached, not retried
      }
    }
  }

  /** The producer finished — notify + detach every subscriber on the channel. */
  end(channelKey: string): void {
    const subscribers = this.channels.get(channelKey)
    if (subscribers === undefined) return
    this.channels.delete(channelKey)
    for (const subscriber of subscribers) {
      try {
        subscriber.onEnd()
      } catch {
        // detached regardless — nothing left to protect
      }
    }
  }
}

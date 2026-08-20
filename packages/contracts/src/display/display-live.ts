// The `display` live channel's vocabulary — how a widget appearing, changing
// or leaving reaches the windows that are watching, while Claude is still
// talking. The route publishes in-process the moment its transaction commits;
// the outbox row stays the durable record for any slower consumer (the relay's
// 5 s tick is far too slow for "appears as it is said").
//
// The channel itself (key parsing, the hub source, the authorizer arm) lands
// in P2c — this file is the shared vocabulary all three sides compile against.

import type { DisplayWidgetView } from './display-widget.js'

/** One per-user channel, not one per scope: a window watching the global
 *  Display and one watching a workspace's share the socket, and each frame
 *  carries the `scopeKey` a client filters on. */
export const DISPLAY_LIVE_CHANNEL_KEY = 'display' as const
export type DisplayLiveChannelKey = typeof DISPLAY_LIVE_CHANNEL_KEY

export type DisplayLiveFrame =
  | { kind: 'upserted'; widget: DisplayWidgetView }
  | { kind: 'removed'; widgetId: string; scopeKey: string }
  | { kind: 'cleared'; scopeKey: string }

/** The `display` arm of `LiveChannelServerFrame` — P2c adds it to the union in
 *  `../chat/live-channel.ts`; declaring it here keeps the shape with the
 *  vocabulary it belongs to. */
export type DisplayLiveChannelServerFrame = {
  kind: 'event'
  channel: DisplayLiveChannelKey
  event: DisplayLiveFrame
}

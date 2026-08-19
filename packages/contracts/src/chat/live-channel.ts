// The LIVE CHANNEL wire vocabulary — ONE WebSocket per window carrying every
// real-time source the UI reads (`GET /api/live`). Browsers cap HTTP/1.1 at six
// connections per host, shared by every window/tab of the origin (Tauri's
// WebView2 included); one SSE per live thing exhausted that pool as soon as a
// few threads ran at once. WebSockets live in their own pool, so the channel
// costs the HTTP budget nothing and multiplexes any number of subscriptions:
// the activity feed, session watches, delegation traces.
//
// The events themselves are the SAME vocabularies the SSE routes carry —
// `SessionActivityEvent` on `activity`, `ChatTurnEvent` on session/trace
// channels, the voice daemon's overlay events on `voice:<surface>` (relayed by
// the api — one daemon link per surface instead of one per window) — wrapped
// in a `{ channel, event }` frame. No new event kinds.
//
// Semantics a client can rely on:
//   - `hello` is the first frame; `connectionId` identifies the socket server-side.
//   - `subscribe` is idempotent and answered with `subscribed` (or `error`).
//   - `activity` replays the in-flight turns on subscribe (the feed's contract).
//   - a session/trace subscription is STANDING: a turn's end arrives as
//     `channel-ended` and the subscription stays for the next turn (no
//     re-subscribe). No replay — rows persist per chunk; a late subscriber
//     seeds from the persisted rows (watched-turn-seed).
//   - `ping` arrives every ~25 s; answer with `pong` or the server closes the
//     socket after two missed beats. Any client message counts as liveness.

import type { ChatTurnEvent } from './chat-http.js'
import type { SessionActivityEvent } from './session-activity.js'
import {
  isVoiceSurface,
  type VoiceRelayEvent,
  type VoiceSubscriber,
  type VoiceSurface,
} from '../voice/daemon-events.js'

export const LIVE_CHANNEL_PROTOCOL_VERSION = 1

/** The one path the channel upgrades on (mounted on the gateway, before /api/*). */
export const LIVE_CHANNEL_PATH = '/api/live'

export type LiveChannelKey = string

/** A voice channel key: `voice:<surface>` for a window that only listens (state
 *  + delegated speech), `voice:<surface>:wake` for one that can also RUN a wake
 *  session — the capability rides the key because it is the only thing a
 *  subscriber sends, and the relay/daemon must never hand a wake to a window
 *  that can't hear (the Tauri main window has no Web Speech). */
export type VoiceChannelKey = `voice:${VoiceSurface}` | `voice:${VoiceSurface}:wake`

/** Build channel keys — the ONE home for the key grammar (server + client). */
export const liveChannelKeys = {
  activity: 'activity' as const,
  session: (sessionId: string): LiveChannelKey => `session:${sessionId}`,
  trace: (partialSessionId: string): LiveChannelKey => `trace:${partialSessionId}`,
  voice: ({ surface, wake }: VoiceSubscriber): VoiceChannelKey =>
    wake ? `voice:${surface}:wake` : `voice:${surface}`,
}

export type ParsedLiveChannelKey =
  | { kind: 'activity' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'trace'; partialSessionId: string }
  | { kind: 'voice'; surface: VoiceSurface; wake: boolean }

/** Parse a channel key; null = not a channel this protocol knows. */
export function parseLiveChannelKey(key: string): ParsedLiveChannelKey | null {
  if (key === 'activity') return { kind: 'activity' }
  if (key.startsWith('session:')) {
    const sessionId = key.slice('session:'.length)
    return sessionId === '' ? null : { kind: 'session', sessionId }
  }
  if (key.startsWith('trace:')) {
    const partialSessionId = key.slice('trace:'.length)
    return partialSessionId === '' ? null : { kind: 'trace', partialSessionId }
  }
  if (key.startsWith('voice:')) {
    const [surface, capability, ...rest] = key.slice('voice:'.length).split(':')
    if (!isVoiceSurface(surface) || rest.length > 0) return null
    if (capability === undefined) return { kind: 'voice', surface, wake: false }
    return capability === 'wake' ? { kind: 'voice', surface, wake: true } : null
  }
  return null
}

/** Client → server. */
export type LiveChannelClientMessage =
  | { op: 'subscribe'; channels: LiveChannelKey[] }
  | { op: 'unsubscribe'; channels: LiveChannelKey[] }
  | { op: 'pong' }

export type LiveChannelErrorCode =
  | 'invalid_message'
  | 'unknown_channel'
  | 'not_found'
  | 'limit_exceeded'

/** Server → client. */
export type LiveChannelServerFrame =
  | { kind: 'hello'; connectionId: string; protocolVersion: typeof LIVE_CHANNEL_PROTOCOL_VERSION }
  | { kind: 'subscribed'; channel: LiveChannelKey }
  | { kind: 'unsubscribed'; channel: LiveChannelKey }
  | { kind: 'event'; channel: 'activity'; event: SessionActivityEvent }
  | { kind: 'event'; channel: VoiceChannelKey; event: VoiceRelayEvent }
  | { kind: 'event'; channel: LiveChannelKey; event: ChatTurnEvent }
  | { kind: 'channel-ended'; channel: LiveChannelKey }
  | { kind: 'error'; channel: LiveChannelKey | null; code: LiveChannelErrorCode; message: string }
  | { kind: 'ping' }

/** Parse one raw client message; null = malformed (the server answers `error`
 *  invalid_message and keeps the socket — a client bug must not drop the feed). */
export function parseLiveChannelClientMessage(raw: unknown): LiveChannelClientMessage | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  if (candidate['op'] === 'pong') return { op: 'pong' }
  if (candidate['op'] !== 'subscribe' && candidate['op'] !== 'unsubscribe') return null
  const channels = candidate['channels']
  if (!Array.isArray(channels) || !channels.every((entry) => typeof entry === 'string')) {
    return null
  }
  return { op: candidate['op'], channels: channels as string[] }
}

// The voice daemon's overlay vocabulary as it crosses the api (the live
// channel's `voice:<surface>` relay). The daemon (apps/voice, overlay-channel)
// is the producer of `VoiceDaemonEvent`; the two other arms of
// `VoiceRelayEvent` are the API's OWN words on the same channel —
// `daemon-link` (does the api currently hold a live link to the daemon for
// that surface — the browser end reads it as its "daemon connected" light) and
// `VoiceControlEvent` (what one window tells the others, fanned by the hub).
// They never pass through `parseVoiceDaemonEvent`: it parses what the daemon
// can say, and a daemon that said `display-active` would be lying.

/** Which window a voice subscriber is — the daemon prefers 'dock' for wake
 *  delivery; 'app' tabs get state + play delegated speech. */
export type VoiceSurface = 'app' | 'dock'

export const VOICE_SURFACES: readonly VoiceSurface[] = ['app', 'dock']

export function isVoiceSurface(value: unknown): value is VoiceSurface {
  return value === 'app' || value === 'dock'
}

/** What a voice subscriber declares when it joins: which window it is, and
 *  whether it may RUN a wake session — a host declaration (the display dock
 *  always; a browser tab only with Web Speech; the desktop shell's main window
 *  never), not a feature detect. The daemon hands a wake only to a capable
 *  client — one that took a wake it cannot answer would swallow it silently. */
export interface VoiceSubscriber {
  readonly surface: VoiceSurface
  readonly wake: boolean
}

export type VoiceDaemonEvent =
  | { kind: 'state'; state: string }
  /** `turnWatchdogMs` is the daemon's silence bound, carried so the browser leg
   *  arms the same watchdog per turn (one knob); absent from an older daemon. */
  | { kind: 'wake'; command: string; turnWatchdogMs?: number }
  /** The daemon asks ONE client to play a spoken line (single delivery).
   *  `sessionId` names the chat session that PRODUCED the line (null when the
   *  daemon doesn't know) so a window can tell its own turn's voice from
   *  another producer's. */
  | { kind: 'speak'; text: string; sessionId: string | null }
  /** A wake landed and the daemon wants the DESKTOP APP in front of the user,
   *  showing the Display — the room mirrors the conversation the dock holds.
   *  Goes to app surfaces only: the dock is already the wake window, and a
   *  wake target has a conversation to run, not a view to switch. */
  | { kind: 'show-display' }

/** What one of the user's windows tells the others over the voice channel —
 *  produced by a route in the api, never by the daemon. `display-active` is the
 *  app window's answer to "is the in-app Display on screen right now", which is
 *  the one thing the dock cannot see for itself and the whole basis of its
 *  hide/reveal rule. */
export type VoiceControlEvent = { kind: 'display-active'; active: boolean }

export type VoiceRelayEvent =
  | VoiceDaemonEvent
  | { kind: 'daemon-link'; connected: boolean }
  | VoiceControlEvent

/** Parse one daemon SSE payload; null = not a daemon event (ignored). */
export function parseVoiceDaemonEvent(raw: unknown): VoiceDaemonEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  switch (candidate['kind']) {
    case 'state':
      return typeof candidate['state'] === 'string'
        ? { kind: 'state', state: candidate['state'] }
        : null
    case 'wake': {
      const command = typeof candidate['command'] === 'string' ? candidate['command'] : ''
      const turnWatchdogMs = candidate['turnWatchdogMs']
      return typeof turnWatchdogMs === 'number' && Number.isFinite(turnWatchdogMs)
        ? { kind: 'wake', command, turnWatchdogMs }
        : { kind: 'wake', command }
    }
    case 'show-display':
      return { kind: 'show-display' }
    case 'speak':
      return typeof candidate['text'] === 'string' && candidate['text'] !== ''
        ? {
            kind: 'speak',
            text: candidate['text'],
            sessionId: typeof candidate['sessionId'] === 'string' ? candidate['sessionId'] : null,
          }
        : null
    default:
      return null
  }
}

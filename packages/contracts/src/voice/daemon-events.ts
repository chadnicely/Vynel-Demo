// The voice daemon's overlay vocabulary as it crosses the api (the live
// channel's `voice:<surface>` relay). The daemon (apps/voice, overlay-channel)
// is the producer of the first three; `daemon-link` is the relay's own word on
// whether the api currently holds a live link to the daemon for that surface —
// the browser end reads it as its "daemon connected" light.

/** Which window a voice subscriber is — the daemon prefers 'jarvis' for wake
 *  delivery; 'app' tabs get state + play delegated speech. */
export type VoiceSurface = 'app' | 'jarvis'

export const VOICE_SURFACES: readonly VoiceSurface[] = ['app', 'jarvis']

export function isVoiceSurface(value: unknown): value is VoiceSurface {
  return value === 'app' || value === 'jarvis'
}

/** What a voice subscriber declares when it joins: which window it is, and
 *  whether it may RUN a wake session — a host declaration (the jarvis window
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

export type VoiceRelayEvent = VoiceDaemonEvent | { kind: 'daemon-link'; connected: boolean }

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

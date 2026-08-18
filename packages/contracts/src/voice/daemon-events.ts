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

export type VoiceDaemonEvent =
  | { kind: 'state'; state: string }
  | { kind: 'wake'; command: string }
  /** The daemon asks ONE client to play a spoken line (single delivery). */
  | { kind: 'speak'; text: string }

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
    case 'wake':
      return {
        kind: 'wake',
        command: typeof candidate['command'] === 'string' ? candidate['command'] : '',
      }
    case 'speak':
      return typeof candidate['text'] === 'string' && candidate['text'] !== ''
        ? { kind: 'speak', text: candidate['text'] }
        : null
    default:
      return null
  }
}

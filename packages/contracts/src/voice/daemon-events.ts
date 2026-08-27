// The voice daemon's overlay vocabulary as it crosses the api (the live
// channel's `voice:<surface>` relay). The daemon (apps/voice, overlay-channel)
// is the producer of `VoiceDaemonEvent`; the two other arms of
// `VoiceRelayEvent` are the API's OWN words on the same channel —
// `daemon-link` (does the api currently hold a live link to the daemon for
// that surface — the browser end reads it as its "daemon connected" light) and
// `VoiceControlEvent` (what one window tells the others, fanned by the hub).
// They never pass through `parseVoiceDaemonEvent`: it parses what the daemon
// can say, and a daemon that said `display-active` would be lying —
// `parseVoiceControlEvent` is the api vocabulary's own door.

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
  /** The assistant is about to be HEARD (a routed `speak` line) and the DOCK
   *  should be visible for it — a spoken line with no pixels anywhere is a
   *  voice from nowhere. Goes to dock surfaces only, and broadcast (unlike
   *  `speak`, which is single-delivery to whoever plays the audio): the dock
   *  must appear whichever window ends up playing the line. */
  | { kind: 'show-dock' }

/** A voice conversation's phase as one window reports it to the others — the
 *  same five the orb has, minus the daemon's own `wake`, which never belongs to
 *  a window's session. A tuple so the api's Zod schema and this parser read the
 *  vocabulary from ONE place. */
export const DISPLAY_SESSION_PHASES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'muted',
] as const

export type DisplaySessionPhase = (typeof DISPLAY_SESSION_PHASES)[number]

/** How much of the conversation's last line the wire carries. A reply grows
 *  sentence by sentence with no bound of its own, and the dock draws ONE corner
 *  row — so the producer clamps to the TAIL (the words just said) and the api's
 *  schema reads the same number, or a long reply is rejected at the boundary
 *  and the dock's caption freezes on whatever landed last. */
export const DISPLAY_SESSION_CAPTION_MAX_LENGTH = 280

/** What one of the user's windows tells the others over the voice channel —
 *  produced by a route in the api, never by the daemon.
 *
 *  `display-active` is the app window's answer to "is the in-app Display on
 *  screen right now", which is the one thing the dock cannot see for itself and
 *  the whole basis of its hide/reveal rule. `display-session` is the other half:
 *  the conversation the ROOM is holding, so the dock can MIRROR a session that
 *  lives in the app window — the primary path, since most conversations start
 *  in the room rather than on a wake. */
export type VoiceControlEvent =
  | { kind: 'display-active'; active: boolean }
  | {
      kind: 'display-session'
      live: boolean
      phase: DisplaySessionPhase
      /** The last line of the conversation, clamped to its final
       *  `DISPLAY_SESSION_CAPTION_MAX_LENGTH` characters by the producer. */
      caption: string
    }

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
    case 'show-dock':
      return { kind: 'show-dock' }
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

/** Parse one CONTROL frame off the voice channel; null = not one (the caller
 *  falls through to the daemon vocabulary).
 *
 *  The producer is a Zod-validated route in this repo, so this is not input
 *  validation — it is version skew: a newer app window can announce a phase an
 *  older dock has never heard of, and a dock that parked its orb in it would be
 *  stuck there. Unknown phases read as `idle`, the same tolerance
 *  `toVoiceDaemonState` gives the daemon's own `state`. */
export function parseVoiceControlEvent(raw: unknown): VoiceControlEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  switch (candidate['kind']) {
    case 'display-active':
      return typeof candidate['active'] === 'boolean'
        ? { kind: 'display-active', active: candidate['active'] }
        : null
    case 'display-session':
      return typeof candidate['live'] === 'boolean' && typeof candidate['caption'] === 'string'
        ? {
            kind: 'display-session',
            live: candidate['live'],
            phase: toDisplaySessionPhase(candidate['phase']),
            caption: candidate['caption'],
          }
        : null
    default:
      return null
  }
}

function toDisplaySessionPhase(value: unknown): DisplaySessionPhase {
  if (typeof value !== 'string') return 'idle'
  return DISPLAY_SESSION_PHASES.find((known) => known === value) ?? 'idle'
}

import type { PcmAudio } from '@vynel/voice-engine'

// The seams the voice loop is built on. Kept as injected interfaces so the
// driver's state machine is unit-tested with fakes — no models, no WebSocket.

/** What the driver tells the client to render + do. Maps 1:1 to `VoiceOrbState`;
 *  the client also uses it to open/close its mic (stops sending on `speaking`). */
export type VoiceSessionState = 'idle' | 'listening' | 'wake' | 'thinking' | 'speaking'

/** The brain's answer, reduced to what voice needs: text deltas + a terminal.
 *  The transport layer adapts the runner's `ChatTurnEvent` stream into this. */
export type VoiceBrainEvent =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly message: string }

/** The driver's outbound side — the WebSocket layer implements it; tests fake it. */
export interface VoiceSessionIo {
  /** Announce a state change (drives the orb; tells the client to open/close mic). */
  setState(state: VoiceSessionState): void
  /** Send a synthesized audio segment for the client to play, in order. */
  emitAudio(audio: PcmAudio): void | Promise<void>
  /** All TTS for this turn has been sent — the client replies via
   *  `notifyPlaybackDrained()` once its playback buffer empties. This is the
   *  echo defense: the mic stays closed until the client has actually stopped
   *  speaking, not merely until the server stopped sending. */
  endSpeech(): void
}

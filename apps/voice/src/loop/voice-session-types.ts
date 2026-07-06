import type { PcmAudio } from '@vynel/voice-engine'

// The seams the voice loop is built on. Kept as injected interfaces so the
// driver's state machine is unit-tested with fakes — no models, no audio device.

/** The loop's outward-facing state — for a status line / tray / future overlay.
 *  `idle` = asleep (wake-word only); `listening` = an active conversation. */
export type VoiceSessionState = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking'

/** The brain's answer, reduced to what voice needs: text deltas + a terminal.
 *  The SSE brain client adapts the runner's `ChatTurnEvent` stream into this. */
export type VoiceBrainEvent =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly message: string }

/** The driver's outbound side — the audio shell implements it; tests fake it. */
export interface VoiceSessionIo {
  /** Announce a state change (status line / future overlay). */
  setState(state: VoiceSessionState): void
  /** Play a synthesized audio segment (through the speaker), in order. */
  emitAudio(audio: PcmAudio): void | Promise<void>
  /** All TTS for this turn has been sent — the shell calls `notifyPlaybackDrained()`
   *  once the speaker has actually finished, reopening the mic. The echo defense:
   *  the mic stays closed until playback truly ends, not merely until we stopped
   *  sending audio. */
  endSpeech(): void
}

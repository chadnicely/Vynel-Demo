// The voice daemon's answer to "apply the user's voice pick now" — what the
// daemon's `POST /reload` returns and the api's `POST /voice/reload` relays.

export interface VoiceReloadOutcome {
  /** The selection now in force (a model that was missing keeps the old one). */
  ttsModelId: string
  sttModelId: string
  speakerId: number
  /** Which engines were actually re-created: 'tts' and/or 'stt'. */
  changed: string[]
  /** Picked models that are not on the disk — the old engine stays for those. */
  missing: string[]
}

export type VoiceReloadResponse =
  | ({ reloaded: true } & VoiceReloadOutcome)
  | { reloaded: false; reason: string }

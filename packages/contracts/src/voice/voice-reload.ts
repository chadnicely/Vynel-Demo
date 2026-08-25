// The voice daemon's answer to "apply the user's voice pick now" — what the
// daemon's `POST /reload` returns and the api's `POST /voice/reload` relays.

export interface VoiceReloadOutcome {
  /** The selection now in force (a model that was missing keeps the old one). */
  ttsModelId: string
  sttModelId: string
  speakerId: number
  /** WHERE speaking/hearing run (voice-cloud-providers): 'local' or a
   *  provider id for tts; 'web-speech' | 'local' | a provider id for stt.
   *  Sources always follow the pick — a disconnected provider surfaces at
   *  use (the engine's 409 → the daemon's local fallback), never here. */
  ttsSource: string
  sttSource: string
  /** Which engines were actually re-created: 'tts' and/or 'stt'. */
  changed: string[]
  /** Picked models that are not on the disk — the old engine stays for those. */
  missing: string[]
  /** The daemon has a voice now. False = it is up but every model is still
   *  to be downloaded (an installed app before Settings → Voice). */
  ready: boolean
}

export type VoiceReloadResponse =
  | ({ reloaded: true } & VoiceReloadOutcome)
  | { reloaded: false; reason: string }

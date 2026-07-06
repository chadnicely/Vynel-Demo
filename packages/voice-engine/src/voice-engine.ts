// The model-agnostic voice-engine contract. The rest of Vynel talks to a voice
// backend ONLY through these types, so swapping the backend (sherpa-onnx today,
// an optional Python LuxTTS/Chatterbox sidecar later) never reaches a consumer's
// signatures. Increment 1 ships synthesis (text-to-speech); transcription +
// wake-word land in Increment 2 as additive methods on VoiceEngine.

/** Mono PCM audio in [-1, 1] — the lingua franca between the engine and the loop.
 *  `sampleRate` is the model's native rate (Kokoro 24 kHz, piper 22.05 kHz); the
 *  loop resamples to the transport rate. */
export interface PcmAudio {
  readonly samples: Float32Array
  readonly sampleRate: number
}

/** Per-utterance synthesis knobs. `voiceId` picks a speaker for multi-voice
 *  models (Kokoro ships 11); `speed` scales tempo (1 = natural, >1 faster). */
export interface SynthesizeOptions {
  readonly voiceId?: number
  readonly speed?: number
}

/** A voice engine. Increment 1: text-to-speech only. */
export interface VoiceEngine {
  /** Synthesize `text` to mono PCM at the model's native sample rate. */
  synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio>
}

/** Which TTS model family to load, plus its on-disk files. The app resolves the
 *  paths from env (Zod-validated) and hands them in — the engine never reads env
 *  or knows the download layout. Mirrors the sherpa-onnx model kinds; more kinds
 *  (zipvoice voice-cloning) are added as we adopt them. */
export type TtsModelConfig =
  | {
      readonly kind: 'kokoro'
      readonly model: string
      readonly voices: string
      readonly tokens: string
      readonly dataDir: string
      readonly lengthScale?: number
    }
  | {
      readonly kind: 'vits'
      readonly model: string
      readonly tokens: string
      readonly dataDir: string
      readonly lengthScale?: number
    }

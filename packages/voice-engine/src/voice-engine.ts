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

/** A text-to-speech voice engine. */
export interface VoiceEngine {
  /** Synthesize `text` to mono PCM at the model's native sample rate. */
  synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio>
}

/** A speech-to-text recognizer. The listening half of the loop — mono PCM in,
 *  text out. sherpa-onnx resamples internally, so any input rate is accepted. */
export interface SpeechRecognizer {
  /** Transcribe mono PCM to text (empty string when nothing was said). */
  transcribe(audio: PcmAudio): Promise<string>
}

/** Segments a continuous 16 kHz mic stream into complete utterances. Feed audio
 *  as it arrives; each `push` returns any segments that just closed (speech
 *  followed by silence). The loop transcribes each segment; a wake match on the
 *  transcript starts a turn. */
export interface VoiceActivityDetector {
  /** Feed mono 16 kHz PCM; returns any complete speech segments that closed. */
  push(audio: PcmAudio): PcmAudio[]
  /** Close + return any in-progress segments (call when the stream ends). */
  flush(): PcmAudio[]
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

/** Which STT model family to load, plus its on-disk files. Moonshine (Useful
 *  Sensors) is a 4-file model — the app resolves the paths and hands them in. */
export type SttModelConfig = {
  readonly kind: 'moonshine'
  readonly preprocessor: string
  readonly encoder: string
  readonly uncachedDecoder: string
  readonly cachedDecoder: string
  readonly tokens: string
}

/** The silero-VAD model file + tuning. The app resolves the path; the tuning
 *  knobs default to sensible speech values in the config mapper. */
export interface VadModelConfig {
  /** Path to `silero_vad.onnx`. */
  readonly model: string
  /** Speech-probability threshold (0–1). Higher = less sensitive. */
  readonly threshold?: number
  /** Silence (seconds) after speech that closes a segment. */
  readonly minSilenceDuration?: number
  /** Minimum speech (seconds) for a segment to count (drops blips). */
  readonly minSpeechDuration?: number
  /** Hard cap (seconds) that force-closes a runaway segment. */
  readonly maxSpeechDuration?: number
}

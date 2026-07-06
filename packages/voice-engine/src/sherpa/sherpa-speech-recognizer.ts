import { OfflineRecognizer } from './native.js'
import type { PcmAudio, SpeechRecognizer } from '../voice-engine.js'
import { buildOfflineRecognizerConfig } from './build-offline-recognizer-config.js'
import type { BuildOfflineRecognizerConfigInput } from './build-offline-recognizer-config.js'

// The sherpa-onnx-node speech-to-text recognizer (Moonshine). Loads the ONNX
// model once in the constructor (a stateful native resource → a class) and
// transcribes utterances on demand. Non-streaming: give it a complete segment
// (the loop's VAD/wake stage cuts them). The native lib is reached only through
// `./native.js`, keeping the anti-corruption boundary to one file.

export type SherpaSpeechRecognizerOptions = BuildOfflineRecognizerConfigInput

export class SherpaSpeechRecognizer implements SpeechRecognizer {
  readonly #recognizer: OfflineRecognizer

  constructor(options: SherpaSpeechRecognizerOptions) {
    this.#recognizer = new OfflineRecognizer(buildOfflineRecognizerConfig(options))
  }

  // `decodeAsync` runs the model off the main thread so a transcription never
  // blocks the loop that's also capturing the next utterance.
  async transcribe(audio: PcmAudio): Promise<string> {
    const stream = this.#recognizer.createStream()
    stream.acceptWaveform({ samples: audio.samples, sampleRate: audio.sampleRate })
    await this.#recognizer.decodeAsync(stream)
    return this.#recognizer.getResult(stream).text
  }
}

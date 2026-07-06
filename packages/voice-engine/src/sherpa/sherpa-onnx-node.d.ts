// Ambient types for `sherpa-onnx-node` — the native ONNX addon ships JSDoc but
// no `.d.ts`. This shim declares ONLY the surface Increment 1 uses (offline TTS
// + wave writing), transcribed from the package's `types.js` typedefs. It is
// consumed exclusively through `./native.ts` (the single interop point), which
// carries the triple-slash reference — the anti-corruption boundary, so a
// sherpa-onnx upgrade lands in one folder. Extend as later increments adopt STT
// / VAD / keyword-spotting.

declare module 'sherpa-onnx-node' {
  export interface OfflineTtsVitsModelConfig {
    model?: string
    lexicon?: string
    tokens?: string
    dataDir?: string
    noiseScale?: number
    noiseScaleW?: number
    lengthScale?: number
  }

  export interface OfflineTtsKokoroModelConfig {
    model?: string
    voices?: string
    tokens?: string
    dataDir?: string
    lengthScale?: number
    lexicon?: string
    lang?: string
  }

  export interface OfflineTtsModelConfig {
    vits?: OfflineTtsVitsModelConfig
    kokoro?: OfflineTtsKokoroModelConfig
  }

  export interface OfflineTtsConfig {
    model?: OfflineTtsModelConfig
    maxNumSentences?: number
    numThreads?: number
    provider?: string
  }

  export interface GeneratedAudio {
    samples: Float32Array
    sampleRate: number
  }

  export interface TtsRequest {
    text: string
    sid: number
    speed: number
  }

  export interface WaveObject {
    samples: Float32Array
    sampleRate: number
  }

  export class OfflineTts {
    constructor(config: OfflineTtsConfig)
    readonly sampleRate: number
    readonly numSpeakers: number
    generate(request: TtsRequest): GeneratedAudio
    generateAsync(request: TtsRequest): Promise<GeneratedAudio>
  }

  export function writeWave(filename: string, audio: WaveObject): void

  // The addon is CommonJS: `module.exports` carries every value above and its
  // named exports aren't statically analyzable by Node's ESM loader — so the
  // only runtime-safe import is `import x from 'sherpa-onnx-node'` (default =
  // module.exports). Declared here so that import is typed.
  const nativeModule: {
    OfflineTts: typeof OfflineTts
    writeWave: typeof writeWave
  }
  export default nativeModule
}

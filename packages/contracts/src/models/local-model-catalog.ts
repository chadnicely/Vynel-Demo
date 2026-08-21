// The catalog of LOCAL models Vynel runs on this computer — the embedding
// model behind memory + knowledge search, and the voice models (speech,
// hearing, voice-activity). ONE home for what each model is, where its files
// sit, how they arrive, and who it speaks as; `@vynel/models` downloads and
// probes from it, `@vynel/embeddings` and `@vynel/voice-engine` load from it,
// the Settings screens list it. Pure data — no node APIs, so the browser can
// read it too. Files are POSIX-relative to the model's folder; whoever joins
// them to a directory owns the platform separator.

export type LocalModelKind = 'embedding' | 'tts' | 'stt' | 'vad'

/** One voice a multi-speaker TTS model can speak as. */
export interface LocalModelSpeaker {
  readonly id: number
  readonly name: string
  readonly accent: 'American' | 'British'
  readonly gender: 'female' | 'male'
}

/** How the files reach the disk — every format is fetched by `@vynel/models`
 *  (never by a loader). `hf-hub` files land in transformers.js' own cache
 *  layout (`<cacheDir>/<hfModelId>/<file>`) so it loads them from the disk. */
export type LocalModelSource =
  | { readonly format: 'hf-hub'; readonly hfModelId: string }
  | { readonly format: 'archive'; readonly url: string }
  | { readonly format: 'file'; readonly url: string }

/** Which files make up the model, by the role the loader needs them in. The
 *  family is the loader's switch; the file names are the download's truth —
 *  so the two can never drift. */
export type LocalModelLayout =
  | {
      readonly family: 'transformers'
      readonly config: string
      readonly tokenizer: string
      readonly tokenizerConfig: string
      readonly onnx: string
    }
  | {
      readonly family: 'kokoro'
      readonly model: string
      readonly voices: string
      readonly tokens: string
      readonly dataDir: string
      readonly sampleRate: number
    }
  | {
      readonly family: 'vits'
      readonly model: string
      readonly tokens: string
      readonly dataDir: string
      readonly sampleRate: number
    }
  | {
      readonly family: 'moonshine'
      readonly preprocessor: string
      readonly encoder: string
      readonly uncachedDecoder: string
      readonly cachedDecoder: string
      readonly tokens: string
    }
  | { readonly family: 'silero'; readonly model: string }

export interface LocalModelEntry {
  readonly id: string
  readonly kind: LocalModelKind
  readonly label: string
  /** What it does for the user, in their words — the Settings card's line. */
  readonly description: string
  /** Download size, for the "this will fetch ~340 MB" line. */
  readonly approxBytes: number
  /** Folder under the kind's models directory. */
  readonly folder: string
  readonly source: LocalModelSource
  readonly layout: LocalModelLayout
  readonly speakers?: readonly LocalModelSpeaker[]
}

const TTS_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'
const ASR_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

// Speaker ids follow sherpa-onnx's kokoro-en-v0_19 export (alphabetical by
// voice file); 0 is the model's default blended voice.
const KOKORO_SPEAKERS: readonly LocalModelSpeaker[] = [
  { id: 0, name: 'Default', accent: 'American', gender: 'female' },
  { id: 1, name: 'Bella', accent: 'American', gender: 'female' },
  { id: 2, name: 'Nicole', accent: 'American', gender: 'female' },
  { id: 3, name: 'Sarah', accent: 'American', gender: 'female' },
  { id: 4, name: 'Sky', accent: 'American', gender: 'female' },
  { id: 5, name: 'Adam', accent: 'American', gender: 'male' },
  { id: 6, name: 'Michael', accent: 'American', gender: 'male' },
  { id: 7, name: 'Emma', accent: 'British', gender: 'female' },
  { id: 8, name: 'Isabella', accent: 'British', gender: 'female' },
  { id: 9, name: 'George', accent: 'British', gender: 'male' },
  { id: 10, name: 'Lewis', accent: 'British', gender: 'male' },
]

const MOONSHINE_LAYOUT: LocalModelLayout = {
  family: 'moonshine',
  preprocessor: 'preprocess.onnx',
  encoder: 'encode.int8.onnx',
  uncachedDecoder: 'uncached_decode.int8.onnx',
  cachedDecoder: 'cached_decode.int8.onnx',
  tokens: 'tokens.txt',
}

export const LOCAL_EMBEDDING_MODEL = {
  id: 'minilm-l6-v2',
  kind: 'embedding',
  label: 'MiniLM L6 v2',
  description:
    'Turns your memory entries and knowledge files into vectors so Vynel can search them by meaning.',
  approxBytes: 23_000_000,
  // transformers.js' own cache layout: `<cacheDir>/<hfModelId>/…`.
  folder: 'Xenova/all-MiniLM-L6-v2',
  source: { format: 'hf-hub', hfModelId: 'Xenova/all-MiniLM-L6-v2' },
  layout: {
    family: 'transformers',
    config: 'config.json',
    tokenizer: 'tokenizer.json',
    tokenizerConfig: 'tokenizer_config.json',
    // q8 — transformers.js names the quantized weights `model_quantized.onnx`.
    onnx: 'onnx/model_quantized.onnx',
  },
} as const satisfies LocalModelEntry

export const LOCAL_MODELS: readonly LocalModelEntry[] = [
  LOCAL_EMBEDDING_MODEL,
  {
    id: 'kokoro',
    kind: 'tts',
    label: 'Kokoro',
    description: 'Vynel’s natural voice — eleven English speakers to choose from.',
    approxBytes: 340_000_000,
    folder: 'kokoro-en-v0_19',
    source: { format: 'archive', url: `${TTS_RELEASE}/kokoro-en-v0_19.tar.bz2` },
    layout: {
      family: 'kokoro',
      model: 'model.onnx',
      voices: 'voices.bin',
      tokens: 'tokens.txt',
      dataDir: 'espeak-ng-data',
      sampleRate: 24_000,
    },
    speakers: KOKORO_SPEAKERS,
  },
  {
    id: 'piper-lessac',
    kind: 'tts',
    label: 'Piper (Lessac)',
    description: 'A small single voice — a quick first download.',
    approxBytes: 61_000_000,
    folder: 'vits-piper-en_US-lessac-medium',
    source: { format: 'archive', url: `${TTS_RELEASE}/vits-piper-en_US-lessac-medium.tar.bz2` },
    layout: {
      family: 'vits',
      model: 'en_US-lessac-medium.onnx',
      tokens: 'tokens.txt',
      dataDir: 'espeak-ng-data',
      sampleRate: 22_050,
    },
    speakers: [{ id: 0, name: 'Lessac', accent: 'American', gender: 'male' }],
  },
  {
    id: 'moonshine-tiny',
    kind: 'stt',
    label: 'Moonshine tiny',
    description: 'The lightest way to hear you — fastest, a little less accurate.',
    approxBytes: 50_000_000,
    folder: 'sherpa-onnx-moonshine-tiny-en-int8',
    source: { format: 'archive', url: `${ASR_RELEASE}/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2` },
    layout: MOONSHINE_LAYOUT,
  },
  {
    id: 'moonshine-base',
    kind: 'stt',
    label: 'Moonshine base',
    description: 'Hears you more accurately, still in real time on the CPU.',
    approxBytes: 240_000_000,
    folder: 'sherpa-onnx-moonshine-base-en-int8',
    source: { format: 'archive', url: `${ASR_RELEASE}/sherpa-onnx-moonshine-base-en-int8.tar.bz2` },
    layout: MOONSHINE_LAYOUT,
  },
  {
    id: 'silero-vad',
    kind: 'vad',
    label: 'Silero VAD',
    description: 'Tells speech from silence so Vynel knows when you have finished.',
    approxBytes: 630_000,
    folder: 'silero-vad',
    source: { format: 'file', url: `${ASR_RELEASE}/silero_vad.onnx` },
    layout: { family: 'silero', model: 'silero_vad.onnx' },
  },
]

export const LOCAL_TTS_MODEL_IDS = ['kokoro', 'piper-lessac'] as const
export const LOCAL_STT_MODEL_IDS = ['moonshine-tiny', 'moonshine-base'] as const
export type LocalTtsModelId = (typeof LOCAL_TTS_MODEL_IDS)[number]
export type LocalSttModelId = (typeof LOCAL_STT_MODEL_IDS)[number]

export const DEFAULT_TTS_MODEL_ID: LocalTtsModelId = 'kokoro'
// The accuracy sweet spot, still realtime on CPU.
export const DEFAULT_STT_MODEL_ID: LocalSttModelId = 'moonshine-base'
export const VAD_MODEL_ID = 'silero-vad'

export function findLocalModel(id: string): LocalModelEntry | null {
  return LOCAL_MODELS.find((entry) => entry.id === id) ?? null
}

export function getLocalModelOrThrow(id: string): LocalModelEntry {
  const entry = findLocalModel(id)
  if (entry === null) {
    const known = LOCAL_MODELS.map((row) => row.id).join(', ')
    throw new Error(`Unknown local model "${id}". Known models: ${known}.`)
  }
  return entry
}

/** Every path (file or directory) that must exist under the model's folder for
 *  it to count as installed — derived from the layout, so the loader and the
 *  probe agree by construction. */
export function requiredModelFiles(entry: LocalModelEntry): readonly string[] {
  const layout = entry.layout
  switch (layout.family) {
    case 'transformers':
      return [layout.config, layout.tokenizer, layout.tokenizerConfig, layout.onnx]
    case 'kokoro':
      return [layout.model, layout.voices, layout.tokens, layout.dataDir]
    case 'vits':
      return [layout.model, layout.tokens, layout.dataDir]
    case 'moonshine':
      return [
        layout.preprocessor,
        layout.encoder,
        layout.uncachedDecoder,
        layout.cachedDecoder,
        layout.tokens,
      ]
    case 'silero':
      return [layout.model]
  }
}

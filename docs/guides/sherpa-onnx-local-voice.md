# Local voice with `sherpa-onnx-node` — implementation handover

A field guide for building a fully local voice pipeline (STT + TTS + VAD) in Node.js with
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Everything here is battle-tested in Vynel's
voice daemon — the model choices, the configs, and the chunking strategies below run in production
on CPU, no GPU, no Python, no cloud.

**The headline numbers we measured on a normal desktop CPU:**

| Engine | Model | Speed |
| --- | --- | --- |
| STT | Moonshine tiny (int8) | RTF ~0.014 (**~70× realtime**) — a 5 s utterance transcribes in ~70 ms |
| TTS | Piper (VITS) | RTF ~0.071 (~14× realtime) |
| TTS | Kokoro | slower than piper but natural; realtime with headroom |

Realtime-on-CPU is not a hope, it's validated. The whole game is *architecture*: chunk the input
with VAD, chunk the output at sentence boundaries, and never block the event loop.

---

## 1. The mental model

Three independent engines, one pipeline:

```
mic ──► [resample to 16 kHz mono] ──► VAD (silero) ──► speech segments
                                                            │
                                                            ▼
                                                    STT (Moonshine)
                                                            │
                                                        transcript
                                                            ▼
                                                    your LLM / logic
                                                            │
                                                      text deltas (stream)
                                                            ▼
                                              sentence buffer (chunker)
                                                            │
                                                   complete sentences
                                                            ▼
                                                     TTS (Kokoro)
                                                            │
                                                            ▼
                                            speaker (play while next synthesizes)
```

- **VAD** (voice activity detection) turns a continuous mic stream into discrete *utterances* —
  "speech ended by silence". You never transcribe fixed time windows.
- **STT** is *non-streaming* (offline recognizer): it takes one complete segment and returns text.
  At 70× realtime that's fine — a finished utterance transcribes in tens of milliseconds.
- **TTS** is synthesized *sentence by sentence*, not whole-reply — that's what makes the assistant
  feel fast (§6).

---

## 2. Install and the two import gotchas

```bash
npm i sherpa-onnx-node        # we run ^1.13.3
```

`sherpa-onnx-node` is a **native addon**; it pulls a platform-specific package
(`sherpa-onnx-win-x64`, `sherpa-onnx-linux-x64`, `sherpa-onnx-darwin-arm64`, …) automatically.
Do **not** confuse it with the `sherpa-onnx` **WASM** package — portable, but far slower on CPU
and wrong for realtime.

**Gotcha 1 — ESM import.** It's a CommonJS module whose named exports Node's ESM loader can't
statically resolve. `import { OfflineTts } from 'sherpa-onnx-node'` **throws at load time**. Use a
default import and destructure:

```ts
import sherpaOnnxNode from 'sherpa-onnx-node'
const { OfflineTts, OfflineRecognizer, Vad } = sherpaOnnxNode
```

**Gotcha 2 — one boundary file.** Keep the import in exactly ONE file of your codebase and
re-export typed bindings from there. The shipped typings can lag the runtime; when they do, write
your own ambient `.d.ts` against the *actual runtime behavior* and reference it from that one file.
Every sherpa API change then lands in one folder.

---

## 3. Models — what to download and why

All models are free downloads from the sherpa-onnx GitHub releases:

- TTS: `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/<archive>`
- STT + VAD: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/<archive>`

| Role | Model | Archive / file | Size | Notes |
| --- | --- | --- | --- | --- |
| TTS (default) | **Kokoro** | `kokoro-en-v0_19.tar.bz2` | ~340 MB | 11 natural English voices, 24 kHz output |
| TTS (small) | **Piper lessac** (VITS) | `vits-piper-en_US-lessac-medium.tar.bz2` | ~61 MB | 1 voice, 22.05 kHz — good first download |
| STT | **Moonshine tiny** (int8) | `sherpa-onnx-moonshine-tiny-en-int8.tar.bz2` | ~50 MB | lightest realtime STT |
| STT (better) | **Moonshine base** (int8) | `sherpa-onnx-moonshine-base-en-int8.tar.bz2` | ~240 MB | the accuracy sweet spot, still realtime |
| VAD | **Silero VAD** | `silero_vad.onnx` (single file) | ~630 KB | 16 kHz only |

Why Moonshine over Whisper: ~107 ms latency vs ~11 s for Whisper-Large-V3 in our old stack, with
*better* accuracy at 6× fewer parameters. It is the single biggest "voice feels slow" fix.

**Ship a fetch script, not the models.** They're tens–hundreds of MB — gitignore the models dir and
write a small idempotent downloader (`fetch → tar -xf → rm archive`). Fail model-load with a clear
"run the fetch script" message *before* touching the native layer.

---

## 4. Constructing the engines

The configs below are the exact shapes that work. `provider` is always `'cpu'`. Thread budget that
leaves the machine usable: **TTS 2, STT 2, VAD 1**.

### TTS — `OfflineTts`

```ts
// Kokoro
const tts = new OfflineTts({
  numThreads: 2,
  provider: 'cpu',
  model: {
    kokoro: {
      model: 'models/kokoro-en-v0_19/model.onnx',
      voices: 'models/kokoro-en-v0_19/voices.bin',
      tokens: 'models/kokoro-en-v0_19/tokens.txt',
      dataDir: 'models/kokoro-en-v0_19/espeak-ng-data',
    },
  },
})

// Piper / any VITS model
const tts = new OfflineTts({
  numThreads: 2,
  provider: 'cpu',
  model: {
    vits: {
      model: 'models/vits-piper-en_US-lessac-medium/en_US-lessac-medium.onnx',
      tokens: 'models/vits-piper-en_US-lessac-medium/tokens.txt',
      dataDir: 'models/vits-piper-en_US-lessac-medium/espeak-ng-data',
    },
  },
})

tts.sampleRate   // the model's native output rate (Kokoro: 24000) — resample to your device rate
tts.numSpeakers  // Kokoro: 11

const audio = await tts.generateAsync({ text: 'Hello there.', sid: 0, speed: 1 })
// audio.samples: Float32Array, audio.sampleRate: number
```

**Always `generateAsync` / `decodeAsync`, never the sync variants** — they run the model off the
main thread, so synthesis never blocks the event loop that's also streaming audio out.

### STT — `OfflineRecognizer` (Moonshine)

Moonshine ships 4 ONNX files + tokens; the config names each:

```ts
const recognizer = new OfflineRecognizer({
  modelConfig: {
    moonshine: {
      preprocessor: 'models/moonshine/preprocess.onnx',
      encoder: 'models/moonshine/encode.int8.onnx',
      uncachedDecoder: 'models/moonshine/uncached_decode.int8.onnx',
      cachedDecoder: 'models/moonshine/cached_decode.int8.onnx',
    },
    tokens: 'models/moonshine/tokens.txt',
    numThreads: 2,
    provider: 'cpu',
  },
})

async function transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate })
  await recognizer.decodeAsync(stream)
  return recognizer.getResult(stream).text
}
```

A fresh stream per utterance. Give it one *complete* segment (from the VAD); it is not a
streaming recognizer.

### VAD — `Vad` (Silero)

```ts
const vad = new Vad(
  {
    sileroVad: {
      model: 'models/silero-vad/silero_vad.onnx',
      // Optional tuning — omit to keep the model defaults:
      // threshold, minSilenceDuration, minSpeechDuration, maxSpeechDuration
    },
    sampleRate: 16000,
    numThreads: 1,
    provider: 'cpu',
  },
  30, // internal ring buffer, seconds — longer than any single utterance,
      // so a long sentence is never dropped before maxSpeechDuration closes it
)
```

⚠ **The VAD trusts its configured rate and does not resample.** Feed it anything but 16 kHz mono
and it silently misbehaves. (The recognizer *does* resample internally, but feed it 16 kHz anyway
for consistency.)

---

## 5. Input chunking — the STT side

The listening loop, in full:

```ts
// 1. Capture mic at whatever the device gives you (typically 48 kHz stereo).
// 2. Downmix to mono + resample to 16 kHz — see the resampling warning below.
// 3. Push into the VAD; it emits complete utterance segments.
// 4. Transcribe each segment as it arrives.

function onMicFrames(samples: Float32Array /* 16 kHz mono */): void {
  vad.acceptWaveform(samples)
  while (!vad.isEmpty()) {
    const segment = vad.front().samples  // one complete utterance
    vad.pop()
    void handleUtterance(segment)       // transcribe + act; don't block capture
  }
}

async function handleUtterance(segment: Float32Array): Promise<void> {
  const text = (await transcribe(segment, 16000)).trim()
  if (!text) return  // noise / breath — silero already filtered most of it
  // ...wake-word check, or feed to the LLM...
}
```

Why this is the fast shape:

- **Latency is bounded by the silence gap, not the model.** The user stops talking, silero closes
  the segment (~a few hundred ms of silence), Moonshine transcribes in tens of ms. Response feels
  immediate.
- **Transcribe-everything is ~free at 70× realtime.** We originally planned a dedicated keyword
  spotter for the wake word; Moonshine made it pointless — we just transcribe every segment and
  string-match the wake phrase on the transcript. Fewer models, simpler loop.
- `flush()` the VAD when you want to force out a trailing segment (e.g. on shutdown or when
  closing the mic).

### ⚠ The resampling lesson (learned the hard way)

Going 48 kHz → 16 kHz, we first used box-averaging (mean of each 3-sample window). It *sounded*
fine to humans but **dulled consonants, and STT accuracy dropped measurably** — the model needs
that high-frequency energy. **Use linear interpolation** for the downsample:

```ts
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const out = new Float32Array(outLength)
  const step = (input.length - 1) / Math.max(1, outLength - 1)
  for (let i = 0; i < outLength; i++) {
    const pos = i * step
    const left = Math.floor(pos)
    const right = Math.min(left + 1, input.length - 1)
    const frac = pos - left
    out[i] = input[left] * (1 - frac) + input[right] * frac
  }
  return out
}
```

Downmix stereo → mono by averaging channels *before* resampling. All sherpa input is
`Float32Array` PCM in `[-1, 1]`.

---

## 6. Output chunking — the TTS side (this is what makes it feel fast)

**Never synthesize the whole reply at once.** If the LLM streams a 4-sentence answer and you wait
for the full text, then synthesize it in one `generateAsync`, the user hears seconds of dead air
and then a wall of speech. Instead: **feed the LLM's text deltas into a sentence buffer, and
synthesize each sentence the moment its boundary arrives** — sentence N plays while sentence N+1
synthesizes and the LLM is still writing sentence N+2.

The whole chunker is ~25 lines, pure, and easily unit-tested. This is Vynel's production one:

```ts
// A sentence boundary is a run of .!? followed by whitespace, or a newline —
// so a decimal like "3.14" (period followed by a digit) is never split.
export class SpokenSentenceBuffer {
  #buffer = ''

  /** Append a delta; returns any COMPLETE sentences now ready to speak, in order.
   *  The trailing partial sentence stays buffered until its boundary arrives. */
  push(textDelta: string): string[] {
    this.#buffer += textDelta
    const sentences: string[] = []
    for (;;) {
      const match = this.#buffer.match(/^[\s\S]*?(?:[.!?]+(?=\s)|\n)/)
      if (!match) break
      const sentence = match[0].trim()
      if (sentence) sentences.push(sentence)
      this.#buffer = this.#buffer.slice(match[0].length)
    }
    return sentences
  }

  /** Call at stream end — a final sentence with no trailing space/newline is still spoken. */
  flush(): string[] {
    const remainder = this.#buffer.trim()
    this.#buffer = ''
    return remainder ? [remainder] : []
  }
}
```

Wire it to a *sequential* speak queue — synthesis may be concurrent with playback, but playback
order must be sentence order, never overlapping:

```ts
const buffer = new SpokenSentenceBuffer()
const speakQueue: string[] = []
let speaking = false

async function drainSpeakQueue(): Promise<void> {
  if (speaking) return
  speaking = true
  try {
    while (speakQueue.length > 0) {
      const sentence = speakQueue.shift()!
      const audio = await tts.generateAsync({ text: sentence, sid: VOICE_ID, speed: 1 })
      await playToSpeaker(audio.samples, audio.sampleRate) // resolves when *queued*, not played
    }
  } finally {
    speaking = false
  }
}

// The LLM streaming loop:
for await (const delta of llmTextStream) {
  speakQueue.push(...buffer.push(delta))
  void drainSpeakQueue()
}
speakQueue.push(...buffer.flush())
void drainSpeakQueue()
```

**The latency math:** first audio = (time to the first sentence boundary in the LLM stream) +
(one sentence of TTS ≈ 100–300 ms on CPU). Versus whole-reply synthesis: (full LLM generation) +
(full-reply TTS). For a 4-sentence answer that's routinely the difference between ~1 s and ~6 s to
first sound.

Two refinements worth stealing:

- **Strip markup before speaking.** LLM output contains markdown (`**bold**`, `- bullets`,
  code fences). Run each sentence through a strip pass first — spoken asterisks are terrible.
- **`maxNumSentences`** in the TTS config caps sherpa's own internal text splitting; with the
  sentence buffer feeding single sentences you won't hit it, but set it consciously if you ever
  synthesize long text directly.

---

## 7. Turn-taking and echo defense

The classic self-hearing bug: the assistant speaks, the open mic hears the speaker, the VAD cuts a
segment, STT transcribes the assistant's own words, and it answers itself.

The discipline that fixes it:

1. **Close (or gate) the mic the moment you start speaking.** Drop all mic input while TTS
   playback is live.
2. **Reopen only on true playback-drain** — when the audio device has actually *finished playing*,
   not when you stopped writing samples to it. Output pipelines buffer; "I sent the last chunk"
   precedes "the speaker went silent" by up to a second. Add a small drain-estimate tail
   (we use ~350 ms after the device reports empty) before reopening.
3. States keep you honest: `asleep` (wake-word only) → `active` (in conversation, every utterance
   is a command, silence timeout returns to asleep) → `busy` (thinking/speaking, mic gated).

**Windows/WASAPI gotcha:** an idle output stream goes cold, and the first write after idling is
silently swallowed. Trickle ~50 ms of silence between real audio to keep the stream warm.

---

## 8. Boot sequence and hygiene

1. Validate env/config first (fail fast with actionable messages).
2. **Check every model file exists before constructing an engine** — a missing file surfaces from
   the native layer as an unhelpful crash; pre-checking gives you "kokoro voices.bin missing — run
   the fetch script".
3. Construct the three engines once, at boot, as long-lived singletons (model load takes seconds;
   never per-request).
4. Log model load: voice count, sample rate — it's your first-line diagnostic.
5. On shutdown: stop the mic, then the speaker, then exit. The engines need no explicit dispose.

---

## 9. Pitfall checklist

- [ ] Default-import `sherpa-onnx-node` (named ESM imports throw at load).
- [ ] Native package, not the WASM one.
- [ ] One import boundary file; own ambient types if the shipped `.d.ts` lags.
- [ ] Everything into VAD/STT: **16 kHz mono Float32** — the VAD does NOT resample; wrong rate
      fails silently as garbage segments.
- [ ] **Linear** resampling for the mic downsample — box-averaging measurably hurts STT.
- [ ] `generateAsync`/`decodeAsync`, never sync, or you'll stutter your own audio output.
- [ ] Sentence-buffer the TTS; never whole-reply synthesis (§6 — the single biggest UX win).
- [ ] Sequential playback queue — concurrent synthesis is fine, overlapping playback never.
- [ ] Mic gated while speaking; reopen on true playback-drain + tail, not on last-write.
- [ ] Models gitignored + idempotent fetch script + pre-flight file check.
- [ ] Resample TTS output (Kokoro: 24 kHz) to your output device's rate.
- [ ] Skip empty/whitespace transcripts — silero passes the occasional breath through.
- [ ] Thread budget: TTS 2 / STT 2 / VAD 1 keeps the machine responsive.

---

## 10. Minimal end-to-end skeleton

```ts
import sherpaOnnxNode from 'sherpa-onnx-node'
const { OfflineTts, OfflineRecognizer, Vad } = sherpaOnnxNode

// --- engines (boot once) ---
const tts = new OfflineTts({ /* §4 kokoro config */ })
const recognizer = new OfflineRecognizer({ /* §4 moonshine config */ })
const vad = new Vad({ /* §4 silero config */ }, 30)

let state: 'listening' | 'busy' = 'listening'

// --- mic loop (16 kHz mono Float32 frames from your audio capture lib) ---
function onMicFrames(frames: Float32Array): void {
  if (state !== 'listening') return // echo defense: deaf while busy/speaking
  vad.acceptWaveform(frames)
  while (!vad.isEmpty()) {
    const segment = vad.front().samples
    vad.pop()
    void onUtterance(segment)
  }
}

async function onUtterance(segment: Float32Array): Promise<void> {
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples: segment, sampleRate: 16000 })
  await recognizer.decodeAsync(stream)
  const text = recognizer.getResult(stream).text.trim()
  if (!text) return

  state = 'busy'
  try {
    const buffer = new SpokenSentenceBuffer() // §6
    for await (const delta of runLlmTurn(text)) {
      for (const sentence of buffer.push(delta)) await speak(sentence)
    }
    for (const sentence of buffer.flush()) await speak(sentence)
    await playbackFullyDrained() // §7 — true drain + tail before reopening the mic
  } finally {
    state = 'listening'
  }
}

async function speak(sentence: string): Promise<void> {
  const audio = await tts.generateAsync({ text: sentence, sid: 0, speed: 1 })
  await playToSpeaker(audio.samples, audio.sampleRate)
}
```

(The skeleton awaits each sentence's synthesis inline for clarity; lift it to the queue pattern in
§6 so synthesis of sentence N+1 overlaps playback of sentence N.)

---

*Source of truth: Vynel's `packages/voice-engine` (the sherpa boundary), `packages/voice`
(sentence buffer, wake word), and `apps/voice` (the loop, audio shell, echo defense). Benchmarks:
2026-07 on desktop CPU via `pnpm voice:bench`.*

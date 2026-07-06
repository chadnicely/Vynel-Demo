# Voice engine — the `@vynel/voice-engine` build (Chad-directed, 2026-07-07)

**Status: 🔵 SCOPED — Gate-1 record. Not a pull; a NET-NEW build.** The pure `@vynel/voice` leaf already
exists (turn-taking + relay logic, pulled 2026-07-04). The *engine* — the audio I/O + STT + TTS + the
always-on loop — was **never** built in KLONE (and the old repo's version is not being ported; see below).
This doc captures Chad's direction, the resolved forks, and the de-risk that settled the approach.

---

## Chad's directive (verbatim intent)
> "We are gonna work on voice. I want to try new models like **LuxTTS** and **Chatterbox Turbo on CPU**.
> We'll have a **similar animation** to the one on local-web as a demo. Whisper was very slow — I want
> realtime STT." … *(on being shown sherpa-onnx)* → chose **sherpa-onnx now, LuxTTS/Chatterbox later**.

## What the old repo did (the gap we're NOT porting)
`apps/voice` in the old repo was a complete always-on loop: **mic → Whisper STT → Kokoro TTS → `/root/turn`
→ speak**, with fast/balanced/accurate modes, driven by a Tauri tray, across ~6 scattered surfaces, **no
tests**. We are **not** porting it. Its Python-adjacent Whisper path is exactly Chad's pain point ("very
slow"), and its structure was flagged for consolidation, not reuse. The pure relay/turn-taking logic was
already lifted into `@vynel/voice`; the imperative shell is rebuilt fresh on a better engine.

---

## Decisions locked (with WHY)

| Fork | Decision | Why |
|------|----------|-----|
| **Surface** | **Web-first** — drive local-web's real `VoiceOrb`; Tauri deferred | Chad said "the animation we have on local-web". Sidesteps the parked M6 Tauri shell (long first cargo build) entirely for v1. |
| **Listen (STT + VAD + wake)** | **sherpa-onnx-node**, all native | No Python. Realtime on CPU. Offline. A *real* wake-word model (KWS), not text-matching. Windows-verified (below). |
| **STT model** | **Moonshine** (`sherpa-onnx-moonshine-tiny-en-quantized`) | ~107ms latency vs ~11s for Whisper-Large-V3; better accuracy at 6× fewer params; streams *while* you talk. This is the fix for "Whisper was slow." Swappable behind the interface (zipformer / whisper.cpp are fallbacks). |
| **Speak (TTS)** | **sherpa-onnx now** (Kokoro or ZipVoice); **LuxTTS/Chatterbox later** as an optional Python backend | Zero Python in v1 → whole loop green fastest. **LuxTTS is "zipvoice-based" and sherpa-onnx ships ZipVoice** (voice cloning) — so ~90% of Chad's ask with no sidecar. The exact LuxTTS/Chatterbox checkpoints plug in later behind the same TTS interface. |
| **Trigger** | **Wake-word "Hey Vynel", always-on** | Chad's pick — the real product experience, not push-to-talk. sherpa-onnx KWS makes it cheap. |
| **Engine contract** | **`@vynel/voice-engine`** — model-agnostic STT/VAD/KWS/TTS behind one interface | "Try both engines" becomes a config flip, not two builds. The Python LuxTTS/Chatterbox backend is a swap, not a rewrite. |

### Why sherpa-onnx over the original Python-sidecar plan
The first plan was a Python sidecar (Moonshine + LuxTTS + Chatterbox). Chad flagged **sherpa-onnx**, which
changed the input side decisively: STT + VAD + wake-word all run **natively in Node** via ONNX Runtime — no
Python, no venv/pip, no cross-language protocol, no new "surface", offline, cross-platform prebuilt
binaries. It cannot host the *exact* LuxTTS/Chatterbox PyTorch checkpoints, which is the ONLY reason a
(TTS-only, later, optional) Python backend survives at all.

### De-risk (the load-bearing dependency — VERIFIED on Chad's Windows box, 2026-07-07)
**The correct package is `sherpa-onnx-node` (native ONNX addon), NOT `sherpa-onnx`.** `sherpa-onnx` on npm
is the **WASM** build (portable but slower on CPU — wrong for realtime); `sherpa-onnx-node` ships the native
addon via a per-platform optional dep (`sherpa-onnx-win-x64/sherpa-onnx.node`). Installed under pnpm in 21s
(prebuilt, **no build-from-source**, no `allowBuilds` entry needed) and `require('sherpa-onnx-node')` **loaded
first try**, exposing exactly the plan's surface — a **class-based** API: `OfflineTts` · `OfflineRecognizer`
(Moonshine STT) · `Vad` (silero) · `KeywordSpotter` (wake-word) · `CircularBuffer` · `writeWave`/`readWave`.
The plan is de-risked on its one hard dependency. **⚠ CJS interop:** the addon is CommonJS with non-lexable
named exports, so `import { OfflineTts }` throws at load under Node ESM — the ONLY runtime-safe form is a
default import (`import x from 'sherpa-onnx-node'` = `module.exports`), quarantined in `sherpa/native.ts`.

---

## Architecture shape

```
apps/local-web ── mic (Web Audio, 16kHz mono) ──WS──► apps/local-api /voice
   real VoiceOrb ◄── state events (idle·wake·listening·thinking·speaking·muted)
                                                          │
                                       ┌──────────────────┴───────────────────┐
                               @vynel/voice-engine (NEW pkg)            @vynel/voice (exists)
                               sherpa-onnx wrapper:                     turn-gate · barge-in ·
                               STT · VAD · KWS · TTS                    sentence-buffer ·
                               (model-agnostic interface)               summarize-turn-for-voice
                                                          │
                                          brain: existing appRequest('/root/turn')
```

- **`packages/voice-engine/`** (NEW, stateless native wrapper — like `providers`/`desktop-control`): depends
  on `sherpa-onnx-node`. Class-based is sanctioned here (a genuinely stateful service that loads + holds
  recognizers). Exposes a model-agnostic `VoiceEngine` interface (`transcribe`, `detectWake`, `synthesize`,
  lifecycle) + a `SherpaVoiceEngine` impl. Keeping the native dep OUT of `@vynel/voice` preserves that
  leaf's purity (its sole dep stays the type-only `@vynel/providers`).
- **`apps/local-api`**: a `/voice` **WebSocket** route via **`@hono/node-ws`** (`createNodeWebSocket` +
  `injectWebSocket(server)` in `server.ts`). The handler is the imperative loop — feeds mic frames through
  the engine + the `@vynel/voice` leaf, re-enters the brain through the existing `appRequest('/root/turn')`
  seam, streams the reply through `summarizeTurnForVoice` + `sentence-buffer` → TTS → audio frames back.
  A boot-owned `startVoiceEngine()` (warm the models once) follows the existing services pattern
  (schedules/channels/delegation), stopped on shutdown.
- **`apps/local-web`**: a `useVoiceSession` composable — `getUserMedia` → AudioWorklet (16kHz mono Float32)
  → WS up; TTS audio down → playback; state events drive the real `VoiceOrb`. This **replaces
  `VoiceOverlayDemo`'s scripted loop** — same orb, same states, real events.

## The `@vynel/voice` leaf's role (what stays vs. what sherpa-onnx supersedes)
- **Stays (plugs in unchanged):** `TurnTakingGate` (mic closed while speaking), `shouldBargeInNow`,
  `sentence-buffer` (feeds TTS sentence-by-sentence for low first-audio latency), `summarizeTurnForVoice`,
  `relay-task-notifier`, `ack-library`.
- **Superseded by sherpa-onnx (better):** the RMS `SpeechSegmenter` → **silero-VAD**; the STT-first
  `detectWakeWord` regex → **KWS acoustic model** (spots the phrase without transcribing the whole room).
  The leaf's segmenter/wake stay as tested fallbacks but the live loop uses sherpa-onnx.
- **⚠ Gap to close:** the leaf's wake phrase is hardcoded **"jarvis"**. Add tolerant **"vynel"** variants
  for the KWS keyword list + any text fallback ("vynel" will mis-hear as *vinyl/vinel/vynell*, same as jarvis
  did). The demo already says "Hey Vynel".

## Model logistics (a real net-new concern)
The ONNX model files (Moonshine STT, silero-VAD, the KWS keyword model, Kokoro/ZipVoice TTS) are tens–to–
hundreds of MB and are **not committed to git**. Plan: a gitignored `.models/voice/` dir (like `.data/`) +
a `scripts/fetch-voice-models` download step, sourcing from the sherpa-onnx model releases
(github.com/k2-fsa/sherpa-onnx/releases · huggingface csukuangfj). Model paths come from env (each app's
`env.ts`, Zod-validated). Pin exact model files in Increment 1.

---

## The build — green increments (each: green gate → code-reviewer → prompt Chad to commit)
1. ✅ **DONE.** `@vynel/voice-engine` contract + `SherpaVoiceEngine` + a fake + fetch/smoke scripts →
   green + Chad-heard. Kokoro/piper TTS on CPU, no Python.
2a. ✅ **DONE.** Moonshine **STT** as a separate `SpeechRecognizer` contract + `SherpaSpeechRecognizer` +
   `pnpm voice:bench`. **Measured on CPU: Moonshine RTF ~0.014 (~70× realtime), piper ~0.071 (~14×)** —
   the realtime-on-CPU premise is validated with room to spare. (Chose a SEPARATE `SpeechRecognizer`
   contract over "transcribe on `VoiceEngine`" — independent model + lifecycle; the loop composes both.)
2b. ✅ **DONE.** **silero-VAD** — `VoiceActivityDetector` contract + `SherpaVoiceActivityDetector` + pure
   `buildVadConfig`; registry generalized for bare-file downloads (silero_vad.onnx). Verified segmenting a
   16 kHz clip. **Wake method revised: VAD-segment → transcribe → leaf `detectWakeWord`, NOT acoustic KWS**
   — Moonshine at ~70× realtime makes transcribe-everything ~free, killing KWS's efficiency case and its
   keyword-file risk; KWS is a deferred later pass (idle efficiency + fewer false wakes). ⚠ VAD needs 16 kHz.
3. **The live loop, sub-sliced (advisor-blessed): 3a core → 3b transport → 3c browser.**
   - 3a ✅ **DONE.** Leaf "vynel" wake-gap closed. `apps/local-api/src/voice/VoiceSessionDriver` — the
     headless loop state machine (injected VAD/STT/synth/brain/io), unit-green (6 tests). Two advisor
     contracts baked in: **echo defense** (mic reopens only on the client's `playback-drained`, not
     server send-done) + **wake-then-pause** (bare "hey vynel" → next segment is the command). **v1 cut:
     no user barge-in** (Chad-accepted).
   - 3b **NEXT** — `@hono/node-ws` `/voice` route: mic frames → `pushAudio`; `VoiceSessionIo` → WS out;
     `playback-drained` msg → `notifyPlaybackDrained`. Streaming `SessionSink` over `runGlobalRootTurnCore`
     → `VoiceBrainEvent` (extract the SSE route's turn-setup into a shared helper, don't copy). Boot
     `startVoiceEngine()` degrades if models absent. Add engine `close()`/dispose (reviewer-flagged).
   - 3c — `useVoiceSession` (getUserMedia → 16 kHz worklet → WS; playback + drained) drives the real
     `VoiceOrb`, replacing `VoiceOverlayDemo`; `ws:true` on the Vite proxy.
4. **Chatterbox / exact-LuxTTS** as a selectable TTS backend behind the same interface (the optional Python
   TTS sidecar) — Chad's original ask, now a plug-in, not the critical path.

**What "green" means here:** the TS side (engine wrapper against a fake, loop wiring, leaf logic, the web
composable's pure parts) is unit-testable and rides the `pnpm test` gate. The models themselves (real STT
accuracy, TTS voice, mic capture, wake sensitivity) are **Chad live-smoke** — inherent to audio ML, matches
how the repo already defers live-boot smoke to Chad.

## Deferred (not gaps — deliberate, behind the interface)
- **LuxTTS / Chatterbox Turbo** exact checkpoints → the optional Python TTS backend (Increment 4). Chatterbox
  on CPU is **not real-time** (GPU-tuned) — it's the voice-clone/quality path, not the default live voice.
- **Tauri overlay window** (M6, parked) — the same `VoiceOrb` mounts there later with the same state events.
- **Acoustic-wake tuning** / custom "Hey Vynel" KWS model if the stock keyword list mis-fires.
- **Proactive/barge-in notifications** spoken at idle (the leaf's `relay-task-notifier` + `shouldBargeInNow`
  are ready) — wire once the core loop is solid.

## Watch-outs
- Native addon + **pnpm** hoisting: `sherpa-onnx-node` is NOT hoisted to the repo root (it's only a dep of
  `@vynel/voice-engine`) — it resolves from the package's own `node_modules` (verified loading under pnpm at
  Increment 1). A root-level `require('sherpa-onnx-node')` will fail; always reach it through the package.
- SSE/WS **buffering through the Vite dev proxy** (the M7 live-boot risk) applies to the audio WS too — watch
  for incremental audio, not one dump at the end.
- `node --watch` (not `tsx watch`) for any turbo dev server on Windows — already the repo standard; the voice
  route rides `apps/local-api` which is already fixed.
```

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
| **Surface** | **Background sidecar** — a separate `apps/voice` (`@vynel/voice-daemon`) process with native mic/speaker; hits the brain over HTTP `/root/turn`. Web/overlay dropped. | **PIVOTED 2026-07-07 (Chad):** priority is a background daemon ("wake it, talk, it responds, silence → it's gone"), not the browser. The engine + loop logic carried over unchanged; only the transport changed (browser/WS → native audio + separate process). |
| **Audio I/O** | **`node-cpal`** — one prebuilt native lib does mic capture AND speaker playback | Verified loads on Chad's Windows box (prebuilt, ships types). Drops the finicky `speaker` build. |
| **Session UX** | **Multi-turn** — wake → talk freely (no re-wake) → ~15 s silence → back asleep | Chad's ask. Idle-timeout is the "after a while it's gone". |
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
- **✅ Closed:** the wake phrase was originally one hardcoded borrowed name. `WAKE_NAME` now carries
  tolerant **"vynel"** + **"claude"** variants (mis-heard as *vinyl/vinel/vynell*); the retired legacy
  spellings are still accepted so an early user keeps being heard. The demo says "Hey Vynel".

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
3. **The background sidecar `apps/voice` (`@vynel/voice-daemon`) — ✅ CODE-COMPLETE + BOOT-VERIFIED**
   (pivoted from the web loop; see the decisions table). Leaf "vynel" wake-gap closed. Pieces:
   - **`loop/VoiceSessionDriver`** — the multi-turn state machine `asleep`→`active`→`busy` (injected
     VAD/STT/synth/brain/io), unit-green. Echo defense (mic reopens only on `notifyPlaybackDrained`) +
     multi-turn conversation with idle-timeout; **v1 cut: no user barge-in** (Chad-accepted).
   - **`brain/`** — SSE frame parser + `mapFrameToBrainEvent` + `createBrainClient` (POST `/root/turn`,
     stream `ChatTurnEvent` → `VoiceBrainEvent`). Unit-tested.
   - **`audio/`** — `audio-format` (resample/downmix/upmix, tested) · `cpal.ts` (node-cpal via `createRequire`
     + a corrected local type — the shipped `.d.ts` is out of sync with the v0.1.1 runtime) · `audio-shell`
     (mic→pushAudio + speaker←emitAudio + duration-based drain).
   - **`main.ts`** — loads the 3 engines, opens mic, runs the loop, degrades if models absent.
   - **Boot-verified:** 3 models load (Kokoro 11 voices), node-cpal enumerates devices (mic+speaker 48 kHz
     stereo → shell converts to/from 16 kHz mono). Two node-cpal live-boot bugs caught + fixed.
   - **⏭ Chad's live mic smoke is the only thing left** (real mic/speaker/room). Live-tune: the drain-timing
     `PLAYBACK_TAIL_MS`, VAD threshold, wake mishears.
4. **Chatterbox / exact-LuxTTS** as a selectable TTS backend behind the same interface (the optional Python
   TTS sidecar) — Chad's original ask, now a plug-in, not the critical path.

**What "green" means here:** the TS side (engine wrapper against a fake, loop wiring, leaf logic, the web
composable's pure parts) is unit-testable and rides the `pnpm test` gate. The models themselves (real STT
accuracy, TTS voice, mic capture, wake sensitivity) are **Chad live-smoke** — inherent to audio ML, matches
how the repo already defers live-boot smoke to Chad.

## ✅ BUILT — the browser voice view + Web Speech command STT (2026-07-07)
The hybrid landed. The daemon stays the always-on LOCAL wake layer (Moonshine "hey vynel", never streams
the room); **on wake a browser voice view owns the command session** — Web Speech API (Google STT) with a
live interim transcript in the orb, the brain over the same `/root/turn` SSE the chat composer uses, and
the reply spoken sentence-by-sentence via browser `speechSynthesis`. **Fork resolutions (as built):**

| Fork | Resolution |
|------|------------|
| Daemon↔browser signaling | The **daemon hosts a loopback Hono server** (`apps/voice/src/overlay/overlay-channel.ts`, `VYNEL_VOICE_DAEMON_PORT` default **18893**): `GET /events` SSE (state replay on connect + wake/state events + 15s ping) · `POST /session/end`. local-web reaches it through a new Vite **`/voice` proxy** (`VYNEL_VOICE_DAEMON_URL`). No `@hono/node-ws` needed — events flow one way, the end-signal is a plain POST. |
| What runs where after wake | **The browser owns the whole active session.** Driver gained a `'handed-off'` state + injected `WakeHandoff` seam: with an overlay client connected, wake publishes `{kind:'wake', command}` (same-breath command included) and the daemon goes deaf until `POST /session/end` or the client disconnects (`onClientsGone`) → back asleep. That deafness IS the cross-process echo defense — the daemon never hears the browser's TTS. |
| Daemon's own STT/TTS | **Kept as the no-browser fallback.** Zero overlay clients → the native Moonshine+Kokoro loop runs exactly as before. |
| Speak (browser) | **`speechSynthesis`**, sentence-by-sentence via the shared `SpokenSentenceBuffer` (prefers a Google en voice). Kokoro-streamed-to-browser is a later quality improve behind the same `SentenceSpeaker` interface. |

**Web pieces** (`apps/local-web/src/composables/voice/`): `speech-recognition.ts` (Web Speech wrapper,
local ambient types, fresh recognition per capture, interim callbacks, rejects only on mic-denial) ·
`speech-synthesis.ts` · `voice-command-session.ts` (the injected browser session machine, unit-tested —
listening→thinking→speaking, idle-silence accumulates across capture attempts, echo defense = recognition
never runs while speaking) · `use-voice-session.ts` (Vue binding + chat-turn-SSE→voice-event adapter) ·
`use-voice-daemon-link.ts` (EventSource + session-end signal). **`VoiceOverlay.vue` replaced
`VoiceOverlayDemo.vue`** — the same orb + layout, real events, live transcript caption, mute/close, a
wake-status line. Manual mic-button sessions work with the daemon down (EventSource just retries).

**Live behavior:** "Hey Vynel" → daemon publishes wake → overlay opens listening (runs the same-breath
command first if there was one) → talk freely, every pause-finalized utterance is a command → 15 s of
silence → overlay closes, `POST /session/end`, daemon resumes wake-listening. Muting ends the capture but
keeps the view; a new wake un-mutes. Web Speech needs Chrome/Edge — other browsers get an explanatory
caption (the daemon-only native loop still works everywhere).

### The FLOATING voice window — today the **display dock** (Chad's pick, same day — "global overlay, not in the tab")
Chad wanted v1's global feel, not an overlay buried in a browser tab. Picked at the time: **a chromeless
Chrome app-window** (`chrome --app=<local-web>/display-dock`, 420×560) that the **daemon opens (or foregrounds)
on wake** — global in practice, full Web Speech. (The fork was decided on the belief that Web Speech
doesn't exist in Tauri's WebView2 — **since DISPROVED by a live probe; see the next section.**)
- **`/display-dock` route** (`views/DisplayDockView.vue`, `meta.bare` — App.vue renders bare routes without the
  shell and without the in-app `VoiceOverlay`, so one window never runs two daemon links). The stage
  (orb + caption + controls) is the shared `components/voice/VoiceStage.vue` + pure `voice-stage-view.ts`
  mapping — the in-app overlay and the window can't drift.
- **Wake targeting:** clients subscribe as `?surface=app|dock`. With `VYNEL_VOICE_DOCK_WINDOW=1`
  (default) the channel delivers wakes ONLY to the newest dock-surface client — app tabs keep state
  events + manual mic sessions but never race the window. `shouldHandOff` is unconditional in this mode.
- **Held wake (`pendingWake`):** a wake nobody confirmed yet is REPLAYED to the next eligible connect —
  the same-breath command survives the window's launch time; a wake written to a dying socket recovers
  on reconnect (this replaced the browser-side "replayed state" hack). Dropped when the daemon leaves
  the wake state. `onClientsGone` now means "the wake RUNNER left" (a mere tab dropping doesn't end a
  live handoff).
- **Launch/focus** (`apps/voice/src/overlay/display-dock-window.ts`): Windows launches via
  `cmd /c start "" chrome --app=…` (App Paths, not PATH) and foregrounds an existing window via
  PowerShell `AppActivate('Vynel Display')` — the title DisplayDockView sets (keep in sync). A **10 s connect
  watchdog** in main.ts ends the handoff if a launched window never connects (Chrome missing / web
  down) so a failed launch can't leave the daemon deaf. Env: `VYNEL_VOICE_DOCK_WINDOW` ('1') ·
  `VYNEL_VOICE_DOCK_URL` (default `http://localhost:18894/display-dock`) · `VYNEL_VOICE_DOCK_BROWSER`
  (chrome|msedge). `0` restores the previous behavior (hand off only to a connected tab, else native).
  ⚠ Renamed from `VYNEL_VOICE_JARVIS_*` (display-dock rename, 2026-08-21). The OLD names are still
  accepted for ONE release via `applyDeprecatedVoiceEnvAliases` in `apps/voice/src/env.ts` (the new
  name wins when both are set); drop that map and its test after this release.
- The window tries `window.close()` when the session settles (allowed while its history is a single
  entry); if Chrome refuses, it stays idle and the next wake reuses it instantly (focus, no launch).
- ⚠ Dev papercut found live: Vite can bind **IPv6-only** (`[::1]:18894`) — IPv4 `127.0.0.1` probes fail
  while `localhost` (→ ::1 in Chrome) works. The dock URL default uses `localhost` for this reason.

### ✅ BUILT same-day on the probe: the Tauri always-on-top overlay + Kokoro overlay voice
Chad greenlit both. **`apps/desktop`** is a deliberately thin Tauri v2 shell: ONE frameless,
transparent, always-on-top 420×560 window (`label: display-dock`, title "Vynel Display") rendering
**local-web's `/display-dock` route** off the dev server (`devUrl localhost:18894`; `frontendDist` points at
local-web's build for later). All overlay behavior lives in the WEB view via `withGlobalTauri` (no
Tauri npm dep — `composables/voice/tauri-overlay-window.ts` wraps the `__TAURI__` global):
**reveal (show+focus) on wake · dismiss (hide) when the session settles · park bottom-right · rounded
draggable stage-card** (`data-tauri-drag-region`; page background forced transparent). Outside Tauri
the same controls fall back to the Chrome app-window behaviors (close/resizeTo). Capabilities:
`core:window:allow-{show,hide,set-focus,set-position,start-dragging}`. `main.rs` is the default
builder; `icons/icon.ico` is a generated gold orb (tauri-build requires one on Windows even
unbundled). Run: `pnpm --filter @vynel/desktop dev` (needs local-web up). A running overlay is just a
connected `dock` client. **On wake with NO overlay connected the daemon now launches the TAURI app
itself** (`VYNEL_VOICE_DOCK_APP`, default the repo's `target/debug/vynel-desktop.exe`) and only
falls back to the Chrome app-window when that executable doesn't exist (fresh clone, not yet built).
**⚠ BEFORE `bundle.active: true` (dev-only assumptions, reviewer-flagged):** the page's relative
`fetch('/voice/…')` + the SDK's `/api` base only work through the Vite dev proxy — a bundled build
serves assets over the Tauri protocol and needs absolute daemon/API URLs (or a Rust-side proxy);
`"url": "/display-dock"` relies on the dev server's SPA fallback — verify the asset protocol resolves it;
and `"csp": null` must become a real CSP (with `withGlobalTauri` any XSS gets the window API —
capabilities scope it to show/hide/position today, but still).

**Overlay speak = Kokoro (Chad's pick: "chatterbox or the sherpa" → sherpa now, Chatterbox stays the
deferred non-realtime quality plug-in).** The channel gained **`POST /synthesize {text}` → WAV**
(pure `audio/wav-encode.ts`; the daemon's already-loaded Kokoro + `VYNEL_VOICE_ID`), and the browser
session speaks through **`daemon-speaker.ts`** — fetch the WAV, play via an Audio element, and fall
back to speechSynthesis **per-sentence** if the daemon is down/failing, so a reply never goes silent.
One voice everywhere (native loop and overlay both Kokoro). ⚠ Restart the daemon after pulling this —
an older running daemon lacks `/synthesize` and the overlay will quietly use the fallback voice.

### ✅ BUILT (2026-07-08): voice-as-communication — the `speak` tool + Haiku channel (Chad-verified live)
Chad's directive: "mcp for voice like speak so any global session can speak directly" + "voice as a
channel with a light model that responds fast and sends to global." Built + working end-to-end.

**The architecture (as-built, after several live-iterated pivots):**
- **`speak` is a brain-surface MCP tool** (`mcp__vynel__speak`, `rootSurface`, `mutatingApproved` →
  auto/no-card). Route `POST /voice/speak` (`apps/local-api/src/routes/voice/`) relays to the daemon's
  overlay channel `POST /speak`. Any global-root session can call it — the light voice session, the
  global brain, a scheduled task. `{ spoken:false, reason }` when the daemon's absent (answer in text).
- **Voice turns are Haiku + a "reply via speak" directive.** `voice:true` threads `/root/turn` →
  `run-global-root-turn-core` → appends `VOICE_TURN_INSTRUCTIONS` ("you're heard ONLY when you call
  `speak`; short spoken sentences, no markdown"). Overlay + daemon brain-client pin `claude-haiku-4-5`.
  So the model DOES the work (read tools / route to a workspace) then SPEAKS a short result — no essay.
- **ONE voice, and the ACTIVE SURFACE plays it.** The `speak` tool is the only voice — no surface reads
  the streamed response aloud (daemon `#runTurn` + browser TTS both removed). ⚠ **Hard-won pivot:** the
  daemon's OWN speaker (node-cpal) can't reach the audio device while the Tauri overlay window (WebView2)
  holds it, AND a cold/idle WASAPI output stream plays nothing. So: **when an overlay is connected it
  PLAYS the reply itself** (`spoken-audio-player.ts` fetches the daemon's Kokoro WAV via
  `/voice/synthesize` and plays it — browser AEC kills the echo for free); the daemon's speaker is used
  ONLY on the no-overlay native loop (where it's warm from the mic). `main.ts` `onSpeak` skips
  `driver.speak` when `overlay.hasClient`. A silence-heartbeat keep-alive (`audio-shell.ts`) keeps the
  native output warm.
- **Browser STT endpointing** (`speech-recognition.ts`): continuous recognition + our OWN 5 s
  silence window (the browser finalizes after ~10-15 words / a phrase-pause and cuts you off), and it
  RESTARTS the recognizer across its auto-ends, stitching the transcript, so a mid-thought pause never
  ends the command.
- **Driver `speak` = a fault-isolated queue** drained even during a handoff (browser owns the mic, the
  speaker's free); preserves prior state (asleep/handed-off), honors a mid-drain `endHandoff`
  (`#endHandoffPending`) so closing the overlay mid-sentence can't leave the daemon deaf.
- **Shared `stripSpokenMarkup`** (`@vynel/voice`) — safety net so a markdown slip never voices "asterisk".

**Reviewer rounds (all applied):** slice-1 cancel-during-playback hang; slice-2 deaf-daemon-on-mid-drain-
endHandoff + speak-during-handoff echo. The daemon-speaker-during-handoff path was the source of the
"caption perfect but no sound" bug — resolved by the browser-plays pivot. Gate **1975/4-skip**.

**Deferred (slice 3, not built):** the true two-tier where Haiku ROUTES a heavy request to the global
brain which then `speak`s back / async fire-and-notify via the dormant `RelayTaskNotifier`; a spoken
fallback when a turn completes without calling `speak` (Haiku occasionally skips — reviewer SHOULD-FIX).

### 🔬 PROBE RESULT (2026-07-07, Chad's box): WebView2 HAS working SpeechRecognition — Tauri overlay UNBLOCKED
A minimal **wry** app (the exact webview Tauri uses on Windows; WebView2 runtime **149**) loaded a test
page and, live on Chad's machine: `window.SpeechRecognition` **exists** (standard name, no webkit
prefix), mic granted, **interim results streamed word-by-word**, final transcript returned **punctuated
and capitalized** ("Hey, can you check the weather for me?") — Edge's Azure-backed recognizer,
Web-Speech-grade. `speechSynthesis` + `getUserMedia` also present. **Consequence: the TRUE always-on-top
transparent Tauri overlay can host the ENTIRE existing browser session** — same
`composables/voice/*` (the wrapper already prefers `SpeechRecognition` over webkit), same daemon
channel, same speak path; DisplayDockView ports as the overlay window's view. The M6 Tauri shell is the
natural next home (`with_always_on_top`, transparency, no taskbar entry); the Chrome app-window stays
the interim surface. Probe source: scratchpad `stt-probe/` (wry 0.55 + tao; ~50-line main.rs; page
posts capability/result events to a local log server). Caveats to re-verify when building for real:
mic-permission behavior under Tauri's permission handler (wry default granted after one prompt), and
whether recognition needs network (Azure-backed — assume yes, same as Chrome's).

## Deferred (not gaps — deliberate, behind the interface)
- **LuxTTS / Chatterbox Turbo** exact checkpoints → the optional Python TTS backend. Chatterbox on CPU is
  **not real-time** (GPU-tuned) — the voice-clone/quality path, not the default live voice.
- **Acoustic KWS wake** (sherpa keyword-spotter) — the robust fix for the invented-word "vynel" mishears if
  the widened text-match list keeps whack-a-mole'ing (currently: base STT + `WAKE_NAME` mishear list).
- **Proactive/barge-in notifications** spoken at idle (the leaf's `relay-task-notifier` + `shouldBargeInNow`
  are ready). **User barge-in** (interrupt Vynel mid-reply) — the v1 no-barge-in cut.
- **Tauri/overlay `VoiceOrb`** — the daemon's `VoiceSessionIo.setState` already emits the orb states; a tray
  or overlay can subscribe later (the web `VoiceOrb`/`VoiceOverlayDemo` were dropped in the pivot).

## Watch-outs
- Native addon + **pnpm** hoisting: `sherpa-onnx-node` is NOT hoisted to the repo root (it's only a dep of
  `@vynel/voice-engine`) — it resolves from the package's own `node_modules` (verified loading under pnpm at
  Increment 1). A root-level `require('sherpa-onnx-node')` will fail; always reach it through the package.
- **Packaged (2026-08-22):** in the installed app the daemon is `resources\engine\dist\voice.mjs`, run by the
  pinned runtime beside the engine; the payload's flat `node_modules` holds `sherpa-onnx-node` +
  `sherpa-onnx-win-x64` (the addon dlopens its DLLs from beside itself — no PATH edit) and `node-cpal` with
  only `bin/win32-x64`. `verify-payload` loads both natives with the staged runtime. The daemon boots with
  an EMPTY engine slot (`apps/voice/src/voice-engine-slot.ts`) when no model is on disk and fills it on
  `/reload` — a fresh install never crash-loops on `VoiceModelMissingError`.
- SSE/WS **buffering through the Vite dev proxy** (the M7 live-boot risk) applies to the audio WS too — watch
  for incremental audio, not one dump at the end.
- `node --watch` (not `tsx watch`) for any turbo dev server on Windows — already the repo standard; the voice
  route rides `apps/local-api` which is already fixed.
```

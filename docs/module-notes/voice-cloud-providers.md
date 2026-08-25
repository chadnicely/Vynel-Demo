# Voice cloud providers — ElevenLabs + Google STT/TTS (Kafi-directed, 2026-08-26)

**Status: 🔵 SCOPED — Gate-1 record.** Net-new build on `feature/voice-providers`
(worktree `.claude/worktrees/voice-providers`, band 18940). Users connect their own
ElevenLabs / Google Cloud account with an API key and use it for TTS and/or STT.
**Web Speech stays the default STT** (Kafi: "web stt is default one as we talk through web");
local sherpa models stay the default TTS. Providers are opt-in.

## What is true today (scout-verified, 2026-08-26)

- **The contract already exists for this.** `packages/voice-engine/src/voice-engine.ts` —
  `VoiceEngine.synthesize(text) → PcmAudio` and `SpeechRecognizer.transcribe(PcmAudio) → string`
  were designed for backend swapping; sherpa-onnx is the only implementation. No vendor SDK or
  provider abstraction exists anywhere (elevenlabs/deepgram/openai grep: 0 hits).
- **STT is a deliberate two-path hybrid**: daemon Moonshine hears ONLY the wake phrase; the
  browser's Web Speech API (`apps/local-web/src/composables/voice/speech-recognition.ts`,
  `CommandRecognizer`) transcribes commands after wake. Swapping the daemon's `SpeechRecognizer`
  alone would NOT change dictation quality — the command leg is the one that matters.
- **TTS has one home**: daemon `VoiceEngines.synthesizer`; the native speaker AND the browser
  (`POST /synthesize` → WAV → `spoken-audio-player.ts`) both go through it — so swapping the
  daemon's TTS covers every surface at once.
- **The factory is hardcoded** (`apps/voice/src/voice-engines.ts` — two `new Sherpa*` calls) and
  four gates fail closed on anything without local files: the env enums (`env.ts`), the id guards
  (`voice-selection.ts`), `getLocalModelOrThrow` (`models.ts`), the on-disk probe
  (`findMissingModelFile`).
- **`apps/voice` has no `@vynel/db` and no `@vynel/sealing`** — the daemon cannot read a
  credentials table. Any key would have to be pushed to it over loopback HTTP or spawn env.
- **Credential storage diverges in-repo**: `channels` stores bot tokens as plaintext JSON
  (`botCredentials text()`, serializer-stripped); `ssh-servers`/`server-install` seal with
  AES-256-GCM via `@vynel/sealing` (keyring master key). The sealed pattern is stricter + newer.
- **The connect-UI is nearly free**: `CHANNEL_CATALOG` + `ChannelCredentialField {key,label,secret}`
  + `ConnectChannelDialog.vue` is a declarative, masked, catalog-driven credential form;
  `connectChannel` verifies over the network BEFORE persisting. Copy that discipline.
- **The reload path already carries engine swaps**: Settings save → `POST /voice/reload` →
  daemon `/reload` → `slot.apply(readSelection())` → `VoiceReloadOutcome`.

## External API facts (pinned 2026-08-26)

| | ElevenLabs | Google Cloud |
|---|---|---|
| Auth | `xi-api-key` header | API key — send as header (`x-goog-api-key`), NEVER a `?key=` query param (keys must not land in URLs/logs) |
| TTS | `POST /v1/text-to-speech/{voice_id}`, `output_format=pcm_24000` (raw PCM ≤24 kHz on any tier; only 44.1 kHz PCM is Pro-gated) | `POST texttospeech.googleapis.com/v1/text:synthesize`, `audioConfig {audioEncoding: LINEAR16, sampleRateHertz}` → base64 |
| STT | `POST /v1/speech-to-text`, multipart `file` (WAV fine), Scribe model → `{text}` | `POST speech.googleapis.com/v1/speech:recognize`, `{config:{encoding:LINEAR16,…}, audio:{content: base64}}` → `results[].alternatives[0].transcript` (sync ≤ ~60 s — fine for utterances) |
| Key validation call | `GET /v1/user` (also yields the subscription tier as the account label) | `GET /v1/voices?languageCode=en-US` (small response) |
| Voices list (Settings picker) | `GET /v1/voices` (account-scoped, ~dozens) | `GET /v1/voices` (global, hundreds — filter by language in the UI) |

Both map cleanly onto `PcmAudio` (Int16LE ↔ Float32) with no new dependencies (global `fetch`).

## Decisions (recommendation-first — Kafi to confirm the ⚖ forks)

| Fork | Decision | Why |
|------|----------|-----|
| **Wake word** | 🔒 **Always local Moonshine, never a provider** | The always-on mic must never stream ambient room audio to a cloud API (privacy + cost). Cloud STT applies ONLY to in-session command transcription. |
| **STT default** | 🔒 **`web-speech`** (Kafi's call) | The overlay/display is the main talking surface; Web Speech is free and gives word-by-word interim captions. Cloud STT is per-utterance (caption updates on pause) — one more reason it's opt-in. |
| **Credential home** | ⚖ **Sealed** (`@vynel/sealing`, ssh-servers pattern), NOT the channels plaintext pattern | A third-party billing key deserves the stricter, newer pattern. Verify-then-persist like `connectChannel`; serializer strips; never logged. |
| **Where cloud calls run** | ⚖ **Engine-side (local-api); the daemon relays** | The daemon has no db/sealing; pushing the opened key over loopback (or spawn env) spreads the secret across processes and needs a boot handshake. Instead the key stays IN the engine process; the daemon's provider-backed engines are thin HTTP relays to engine routes. One loopback hop (~ms) is noise next to cloud RTT (100–500 ms). The browser's cloud-STT leg reuses the very same `/voice/transcribe` route — the credential never reaches a webview. |
| **Provider impl home** | `packages/voice-engine` gains `elevenlabs/` + `google/` beside `sherpa/` | "Model-agnostic STT/TTS behind one interface" is this package's charter; cloud backends are just more backends. Only local-api imports the cloud folders. |
| **Connections home** | New leaf **`@vynel/voice-providers`** (schema + ops + adapter registry) | Leaf-owns-schema vertical slice; `packages/voice` stays pure; mirroring `resolveChannelAdapter`. |
| **Catalog** | **Parallel provider catalog in `@vynel/contracts`** — do NOT widen `LocalModelEntry` | `approxBytes`/`folder`/`layout`/download probes are meaningless for a cloud provider; the local catalog's gates are its enforcement. |
| **Selection** | **New KV preference keys, existing keys untouched** — `voiceTtsSource` (`local\|elevenlabs\|google`, default `local`), `voiceTtsProviderVoiceId` (string), `voiceSttSource` (`web-speech\|local\|elevenlabs\|google`, default `web-speech`). `voiceTtsModelId`/`voiceSttModelId`/`voiceSpeakerId` keep meaning the LOCAL pick (STT one = the wake model). | Schemaless KV = no migration; existing users resolve identically; provider voice ids are strings (ElevenLabs) so they can't ride the numeric `voiceSpeakerId`. |
| **Failure mode** | ⚖ Cloud synth/transcribe failure → typed error + **fall back to the installed local engine when present** (warn-logged), else surface the error | The realtime directive: a reply must never go silent. No silent fallback for STT (a wrong-transcript guess is worse than an honest error caption). |

## The slices (each: green gate → code-reviewer → prompt to commit)

1. **`@vynel/voice-providers` leaf.** `voice_provider_connections` (id, userId, provider,
   encryptedCredentials [sealed], accountLabel, createdAt, updatedAt; unique userId+provider).
   Ops: `connectVoiceProvider` (adapter `verifyCredentials` over the network → seal → upsert +
   `voice.provider-connected` outbox co-commit), `disconnectVoiceProvider`, `listVoiceProviderConnections`
   (status only, never the key). Adapter registry `resolveVoiceProviderAdapter` with
   `verifyCredentials` + `listVoices`. Provider ids/capabilities catalog in `@vynel/contracts`.
2. **Cloud engines in `@vynel/voice-engine`.** `elevenlabs/` + `google/`:
   `ElevenLabsVoiceEngine` / `GoogleVoiceEngine` (`VoiceEngine` + `sampleRate`/`voiceCount`),
   `ElevenLabsSpeechRecognizer` / `GoogleSpeechRecognizer`; constructor `{apiKey, voice/model, fetch?}`
   (fetch injected for tests); shared pure PCM↔WAV/base64 helpers. Exhaustive-switch config
   builders stay honest (`build-offline-tts-config` pattern).
3. **Engine routes + preferences** (`apps/local-api/src/routes/voice/`): `GET /voice/providers`,
   `POST /voice/providers/:provider/connect`, `DELETE /voice/providers/:provider`,
   `GET /voice/providers/:provider/voices`, `POST /voice/transcribe` (WAV in → `{text}`),
   `POST /voice/provider-synthesize` (`{text}` → PCM + rate; daemon-facing). **No x-mcp on any of
   them** (the user's door, the models/reload stance). New preference keys through
   `ResolvedUserPreferences` + Zod + `UserPreferencesResponseSchema`. `api:generate` + parity.
4. **Daemon wiring.** `voice-selection.ts` reads the new keys (fallback intact);
   `voice-engines.ts`'s two `new Sherpa*` become a `resolveVoiceEngines(selection)` factory
   (sherpa | engine-relay); relay impls hold no key. `VoiceReloadOutcome` gains a
   provider-not-connected signal (sibling of `missing`). Wake stays local unconditionally; the
   native leg's in-session STT honors `voiceSttSource` (web-speech → local, as today).
5. **Web.** `VoiceSettingsSection.vue`: TTS/STT source pickers + provider cards (connect dialog
   reusing the `ChannelCredentialField` pattern; live voices picker; Preview through the existing
   player; honest "not connected" states). Browser cloud-STT: a second `CommandRecognizer`
   implementation — AudioWorklet 16 kHz mono → the pure `audio-segmenter` from `@vynel/voice`
   (RMS endpointing, already tested) → WAV → `POST /voice/transcribe`; per-utterance captions.

## Status

| Slice | Commit | Notes |
|---|---|---|
| 1 connections leaf | `a77f4b55` | `@vynel/voice-providers` (sealed creds, connect/disconnect + outbox, adapters, factory) · provider catalog in contracts · migration 0055 · reviewer CLEAN (pairing guard + bounded Google fault applied). |
| 2 cloud engines | `02bd1edf` | Four backends behind the existing contracts + pure `pcm-codec` + `VoiceProviderRequestError` (auth vs provider-down). Scribe v2 confirmed current. |
| 3 engine routes + prefs | in worktree | `/voice/providers` family + the executing `/voice/transcribe` + `/voice/provider-synthesize` doors (no x-mcp anywhere); prefs keys `voiceTtsSource`/`voiceTtsProviderVoiceId`/`voiceSttSource`; `voiceProviderFetch` DI; shared `requireSealingMasterKey` (ssh rewired); voice-engine PURE subpath exports so local-api never loads the sherpa native addon; artifacts regenerated (269 paths, tools unchanged at 121). |
| 4 daemon wiring | next | factory in `voice-engines.ts` (sherpa \| engine-relay), selection reads the new keys, reload outcome carries provider state. |
| 5 web | next | Settings source pickers + provider cards + connect dialog; browser cloud-STT `CommandRecognizer`. |

## Watch-outs

- `SynthesizeOptions.voiceId?: number` is sherpa-shaped; cloud engines take their string voice id
  at construction — do NOT widen the numeric knob.
- The `serializeAsync` synth lane is a sherpa-native mutex; relay engines don't need it but keep
  the lane in v1 (sentence ordering) — parallel per-sentence cloud synth is a later improve.
- Keys in headers only; never in URLs, responses, logs, or error messages (mask in adapter errors).
- Settings menu is declared in BOTH `AppTitleBar.vue` and `AppShell.vue` — no new row needed
  (everything lives inside the Voice screen), but remember if one is ever added.
- ElevenLabs STT model id (`scribe_v1` vs `scribe_v2`) — confirm against `GET /v1/models` at
  implementation time; keep it one constant.
- Google voices list is huge — filter/group by language in the picker.

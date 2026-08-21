# Settings → Embedding · Voice — local models the app can see, download and pick

*Brief from Kafi, 2026-08-22: "we don't have any control on the voice and embedding model — our
desktop app doesn't install any of them. Bring them into Settings: see if the models are downloaded,
change voice, download if missing — so we can ship the embedding for memory/knowledge and the voice."
Research: three scouts (embeddings · voice stack · settings seams), 2026-08-22.*

## What is true today (the gaps, verified)

| | Embedding | Voice |
|---|---|---|
| Engine | `@vynel/embeddings` → transformers.js `Xenova/all-MiniLM-L6-v2` q8, 384-dim, **~23 MB** | sherpa-onnx (`@vynel/voice-engine`): TTS **Kokoro** ~340 MB (11 speakers) or **Piper-lessac** ~61 MB; STT **Moonshine** tiny ~50 MB / base ~240 MB; VAD silero ~630 KB. Wake = regex over STT transcripts (no model). |
| How models arrive | Lazily from the HF Hub on first `generateEmbedding()`; nothing bundled | Dev-only CLI `pnpm voice:fetch-models` (`scripts/src/voice/`), cwd-bound; nothing bundled |
| "Is it downloaded?" | No probe, no `progress_callback`; a missing model = failed 60 s index tick / 120 s MCP timeout | `existsSync` at daemon boot → exit 1 with a hint |
| Choice | Private `const` — none | Env only: `VYNEL_VOICE_TTS`, `VYNEL_VOICE_STT`, `VYNEL_VOICE_ID` (bare int); **no speaker catalog** |
| On disk | `VYNEL_EMBEDDINGS_CACHE_DIR` (desktop: `<app_data>/models/embeddings`) | `VYNEL_VOICE_MODELS_DIR` (dev `.models/voice`; desktop: **not injected**) |
| Packaged desktop | Works online (silent first-run download); fails offline | **No voice daemon is launched at all** → no TTS. The browser leg plays WAV from the daemon's `/synthesize`; there is no `speechSynthesis` fallback (the doc claims one; the file doesn't exist) |
| Hard constraint | `float[384]` baked into both `vec0` DDLs → only 384-dim models without a migration + full re-embed; a per-user model is not expressible (one shared vec table) | Registry duplicated by convention (`scripts/src/voice/voice-models.ts` ↔ `apps/voice/src/models.ts`) |
| Settings surface | none — `application` is an `EmptyState` promising "model, voice, appearance" | none (`voice-chat` id is taken by the spoken thread's window) |

Nothing in the repo streams byte/percent progress; the closest job precedent is `server-install`
(fire-and-track, the row is the progress surface, adaptive poll).

## Shape of the move

**Five slices, one worktree, landed in order; 1–4 make dev whole, 5 is the installer.**

### Slice 1 — the catalog + one download runner (packages)

- `packages/contracts/src/models/model-catalog.ts` — ONE typed registry for every local model: `id`,
  `kind: 'embedding' | 'tts' | 'stt' | 'vad'`, `label`, `approxBytes`, `folder`, `files[]`,
  `download: { format: 'hf-hub' | 'archive' | 'file', url, sha256? }`, and for TTS the **speaker
  catalog** (id → name · accent · gender; Kokoro's 11, Piper's 1 — net-new data, verified against the
  model READMEs). Pure data in `contracts` so every leaf can read it without sibling imports.
- `@vynel/models` (new leaf, stateful by nature): `ModelDownloadRunner` — one job per model id,
  `fetchToFile` with byte progress, optional sha256 verify, archive extract (`tar`, the existing
  Windows-safe recipe), partial-dir wipe on failure, and a `.vynel-model.json` stamp written only
  after a verified install (**presence on disk is not proof** — the embeddings heal path taught us
  that). `probeInstalledModel(dir, entry)` = stamp + files.
- `@vynel/embeddings`: `probeEmbeddingModel()` + `warmEmbeddingModel({ onProgress })` riding
  transformers.js' `progress_callback` (its own downloader stays — it owns the HF cache layout).
- `@vynel/voice-engine`: configs derived from the catalog (`toTtsConfig(baseDir, entry)` …);
  `apps/voice/src/models.ts` and `scripts/src/voice/voice-models.ts` die — the CLI becomes a thin
  caller of the runner.

### Slice 2 — API

- `routes/models/`: `GET /models` (every catalog entry with `installed | missing | downloading
  {bytes,total} | failed {message}`), `POST /models/:id/download`, `DELETE /models/:id`. **No
  `x-mcp`** — the user's door, not an agent tool (the `server-install` stance). Progress = in-memory
  job on the runner, polled at 1 s while downloading; no table (a one-step job; a dead process
  leaves an unstamped dir that the probe reports as missing and the next download wipes).
- Voice choice → `user_preferences` keys `voiceTtsModelId`, `voiceSpeakerId`, `voiceSttModelId`
  (schemaless KV, no migration; extend the closed `ResolvedUserPreferences` resolver + Zod).
- `VYNEL_VOICE_MODELS_DIR` joins `apps/local-api/src/env.ts` (same default as the daemon's);
  `daemon.rs` injects it as `<app_data>/models/voice` beside `embeddings/`.
- `pnpm api:generate` → committed artifacts; the five parity guards.

### Slice 3 — Web

- `GLOBAL_SYSTEM_ITEMS` gain `group: { id: "settings", label: "Settings" }` + two rows:
  `embedding` ("Embedding") and `voice-settings` ("Voice"). Generic grouping in `AppSidebar` — no
  catalog entry, no customization migration (rows are pinned like Engine/Account/Application today).
- `ChatMainView` + `GlobalChatView` branches; `EmbeddingSection.vue` (model card: name, size, dims,
  what it powers, status, Download / Remove, progress bar, pending-index counts) and
  `VoiceSettingsSection.vue` (TTS cards with status + download; speaker picker with **Preview**
  through the existing spoken-audio player; STT card; honest "voice daemon not running" banner).
- Composables modelled on `server-install`: `use-model-status` (poll while a job runs),
  `use-start-model-download`, `use-remove-model`, `use-voice-preferences`.

### Slice 4 — make the pick take effect

- Daemon `POST /synthesize` honours a per-request `voiceId` (the player sends the preference) →
  speaker changes are live. TTS/STT **model** changes re-create the engine via a daemon
  `POST /config/reload`; the daemon reads preferences (API) with env as the fallback. The screen
  says "restart voice to apply" only where a reload can't.

### Slice 5 — ship it (its own arc, Chad's distribution territory)

The packaged app must spawn the voice daemon as a second sidecar with the env above, carry
sherpa-onnx-node's native binaries through `prune-payload` / `verify-payload`, and offer the
first-run "download the voice + embedding models" step. Until then the screens are honest: a
packaged install shows voice as "not available in this build".

## Status (2026-08-22)

| Slice | Commit | Notes |
|---|---|---|
| 1 catalog + runner | `d88dd2be` | `@vynel/contracts/models/local-model-catalog` · `@vynel/models` (probe, fetch w/ progress, extract, stamp, runner) · embeddings `warmEmbeddingModel`/`evictEmbeddingModelCache` · voice-engine `resolveTtsConfig`/`resolveSttConfig`/`resolveVadConfig` · daemon + scripts read the catalog (`scripts/src/voice/voice-models.ts` deleted; `moonshine` id → `moonshine-tiny`). Stamp is metadata, not proof: a hand-fetched `.models/` keeps working. |
| 2 API | `09fee7e3` | `GET /models`, `POST /models/:id/download`, `POST /models/:id/cancel`, `DELETE /models/:id` (no x-mcp); `localModels` app dep built in boot (hf-hub installer/remover lent by embeddings); `VYNEL_VOICE_MODELS_DIR` in api env + `daemon.rs`; `user_preferences` keys `voiceTtsModelId` / `voiceSpeakerId` / `voiceSttModelId`; artifacts regenerated, parity green. |
| 3 Web | `90d92c0f` | Settings group (Embedding · Voice · Where Vynel runs · Application; Account standalone); `EmbeddingSection`, `VoiceSettingsSection`, shared `LocalModelCard` + `describeLocalModelState`; `use-local-models` (1 s poll while downloading), `use-local-model-actions`, `use-user-preferences`. |
| 4 take effect | shipped | the daemon reads the pick from `GET /users/me/preferences` at boot (env fallback, `voice-selection.ts`); engines live in one holder (`voice-engines.ts`) and the shared synth lane injects the speaker — the ONE place the pick is applied (no `voiceId` threaded through driver/host/overlay any more); daemon `POST /reload` → `engines.apply()` swaps only what changed and is installed; api `POST /voice/reload` relays (best-effort, no x-mcp); the Voice screen saves then reloads and says "Applied." / "applies when the voice starts" / "<model> is not downloaded yet"; Preview plays a sample through the normal player. **Owed by Kafi:** `pnpm dev:voice` smoke — pick a speaker, Preview, switch to Piper, hear the swap. |
| 5 ship | parked | own arc on the distribution branch. |

## Found on the way: the engine could never download the embedding model (pre-existing)

The first live test of Settings → Embedding failed inside the API with transformers.js'
"Unable to get model file path or buffer", while the identical call in a standalone process
succeeded. Probe: `cacheDir` / `useFSCache` / `allowRemoteModels` were all right. Cause:
`getModelFile` only caches a download when `response instanceof Response` — and
`@hono/node-server` replaces `globalThis.Response` in the engine process, so undici's Response
fails the check, the ONNX weights are never written, and `return_path` has nothing to hand back.
The small JSON files "worked" because they are returned as buffers. So on a fresh machine the
memory/knowledge embedding ticks could never succeed (the Jul-11 cache in the main checkout came
from somewhere else). **Fix (this arc):** `@vynel/models` fetches the Hub files itself into
transformers.js' cache layout (same URLs), `@vynel/embeddings` sets `allowRemoteModels = false`
and throws a typed `EmbeddingModelNotInstalledError` fast when the files are absent, the indexing
ticks hand that to boot's `downloadEmbeddingModelOnce` (through the same runner, visible in
Settings, never auto-retried after a failure), and the hf-hub installer validates by loading
the model once after the files land.

## Forks (recommendation first) — Kafi took every recommendation (2026-08-22)

1. Settings group membership — Embedding · Voice **+ Where Vynel runs + Application** under it,
   Account stays standalone (identity, not a setting); `Ctrl+,` keeps pointing at Application.
2. Embedding picker in v1 — **status + download only** (the 384 lock); a curated 384-dim picker
   with a re-embed op is a follow-up.
3. Voice choice home — **`user_preferences`** (per-user, migration-free, API door exists).
4. The installer slice — **park as its own arc**; slices 1–4 first.

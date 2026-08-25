# 2026-08-26 — Voice cloud providers (ElevenLabs + Google STT/TTS)

Kafi's directive: users connect their own platform with an API key and use it for STT and/or
TTS; web speech stays the default hearing ("we talk through web"); ElevenLabs + Google now, more
later. Built on `feature/voice-providers` (worktree, band 18940), five gate-green slices.

## What landed

1. `@vynel/voice-providers` — sealed connections (AES-256-GCM, the ssh-servers pattern), verify-
   before-persist, outbox co-commits, adapter factory. Migration 0055. Reviewer CLEAN.
2. `@vynel/voice-engine` grew `elevenlabs/` + `google/` beside `sherpa/` behind the SAME
   contracts, plus the pure `pcm-codec` and `FallbackVoiceEngine`.
3. Engine doors `/voice/transcribe` + `/voice/provider-synthesize` + the `/voice/providers`
   family; prefs `voiceTtsSource` / `voiceTtsProviderVoiceId` / `voiceSttSource`.
4. Daemon: source-routing engines holder; wake pinned local; relay engines with no credential.
5. Web: provider cards + hearing source picker + the AudioWorklet cloud recognizer.

## Learnings worth keeping

- **The engine resolves provider + voice per request → the daemon's relay engines are
  source-agnostic.** Switching provider or voice never swaps a daemon engine; only local↔relay
  flips rewire. That collapsed the reload planner to "sources pass through untouched".
- **The voice-engine BARREL is a native-addon landmine.** `import '@vynel/voice-engine'` eagerly
  loads sherpa-onnx-node; the engine/web processes must import the pure subpaths
  (`/provider-engines`, `/pcm-codec`) only. Pinned in STATE + the module note.
- **Wake stays local, structurally.** The driver picks the transcription lane by its own state:
  asleep = the local recognizer, in-conversation = the session lane. The always-on mic can never
  reach a cloud API by construction, not by convention.
- **Sealed > plaintext for third-party billing keys.** channels' plaintext `botCredentials` and
  ssh's sealed blob diverge; new credential stores should take the sealed pattern (and the
  `requireSealingMasterKey` gate now has one home in local-api).
- **Serialized-lane identity check.** When the session recognizer IS the sherpa instance it must
  ride the existing serialized lane (one native addon); the relay needs no mutex. Identity
  comparison in `main.ts` keeps that one decision visible.

## Owed

- Kafi's live smokes: connect a real key → Preview a cloud voice → overlay cloud-STT round trip
  → cloud-down fallback line. Merge to main + worktree teardown after.
- Deferred: cloud dictation (composer mic), per-language STT preference, parallel per-sentence
  cloud synthesis (drop the shared lane for relays), `sshMasterKey` → `sealingMasterKey` rename.

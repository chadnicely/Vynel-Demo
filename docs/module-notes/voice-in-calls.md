# Voice in calls — handoff spec

**Self-contained brief for a separate session/worktree.** Split agreed with Kafi 2026-08-11: the
desktop-autopilot arcs are handled elsewhere (`docs/module-notes/desktop-autopilot.md`); this note
owns everything voice. The two share **zero code** — verified: `apps/voice` / `packages/voice*`
never import `desktop-control`, and `desktop-control` never imports voice.

Source material: `.tmp/jarvis-guides/JARVIS_VOICE_CALLS.md`. **Read the "Rejected" section below
before implementing anything from that guide** — a large part of it duplicates what we already
ship, or ships it worse.

---

## The baseline (what already exists — do not rebuild)

`apps/voice` (`@vynel/voice-daemon`) is an always-on native sidecar. Full chain, all CPU, **no
Python, no ffmpeg, no mpv** — the zero-ffmpeg stance is deliberate and recorded at
`.claude/docs/_apps/voice/structure.md:164`.

| Stage | Implementation | Anchor |
|---|---|---|
| Capture | `node-cpal`, **default input device only**, downmix+resample to 16 kHz in pure JS | `apps/voice/src/audio/audio-shell.ts:96-115` |
| Segmentation | sherpa **silero-VAD**, 16 kHz fixed, 30 s ring buffer | `packages/voice-engine/src/sherpa/sherpa-voice-activity-detector.ts:19-44` |
| STT | sherpa **`OfflineRecognizer` + Moonshine**, one-shot per closed segment, `decodeAsync` | `packages/voice-engine/src/sherpa/sherpa-speech-recognizer.ts:14-28` |
| Wake | pure regex `detectWakeWord` | `packages/voice/src/turn-taking/wake-word.ts:37-42` |
| Brain | `POST {VYNEL_API_URL}/root/turn` SSE | `apps/voice/src/brain/run-brain-turn.ts:50-53` |
| TTS | sherpa **`OfflineTts`** (Kokoro default, 11 voices), **`generateAsync`** — already off-thread | `packages/voice-engine/src/sherpa/sherpa-voice-engine.ts:25,33-38` |
| Pipelining | `SpokenSentenceBuffer` — per-sentence synth+play, already pipelined | `packages/voice/src/relay/sentence-buffer.ts:13-37` |
| Playback | `node-cpal`, **default output only**, in-memory `Float32Array` straight to the stream | `apps/voice/src/audio/audio-shell.ts:44,68-78` |

The native sherpa addon is quarantined to exactly one file **by design**:
`packages/voice-engine/src/sherpa/native.ts:1-9`.

---

## The finding that shapes this work (verified live, not read off docs)

`node-cpal` exposes device enumeration at runtime, and our own corrected binding **already types
`deviceId` as `createStream`'s first argument** (`apps/voice/src/audio/cpal.ts:36-41`):

```
getDevices() -> [{ name, deviceId, hostId, isDefaultInput, isDefaultOutput }, ...]
createStream(deviceId, isInput, config, callback)
```

Live probe on the dev machine returned 6 WASAPI devices with usable ids.

**Consequence: Vynel can open a virtual audio cable by device id, directly.** That deletes the
guide's entire §2.5 — no `svcl.exe`/NirSoft, no `pactl`/`macos-audio-devices` bridge, no mutating
the user's machine-wide audio defaults, no save-and-restore dance, no "switch before the call app
launches" hazard. The guide only needs that section because its transport (`mpv`/`ffmpeg`)
addresses devices *by name at spawn time*; ours addresses them *by handle*.

⚠ `node-cpal`'s shipped `index.d.ts` **skews from the v0.1.1 runtime** (it declares
`createInputStream`/`createOutputStream`; the runtime has `createStream`). That skew is the entire
reason `apps/voice/src/audio/cpal.ts` exists — it is the single corrected boundary. Type any new
call against the **runtime**, and confirm live, following that file's own precedent.

---

## Rejected from the guide — do not build these

| Guide item | Why not |
|---|---|
| §1 `os/voice.ts` | A **second sherpa wrapper**, breaking the one-file quarantine. Also uses the **blocking** `generate()` where we already use `generateAsync`, and its wav-file + `mpv` transport is strictly worse than our in-process float write (`audio-shell.ts:68-78`). |
| §1 `isSpeaking()` boolean | We already have a richer gate: driver state `'busy'` drops mic frames (`voice-session-driver.ts:101`) **plus** a playback-drain estimate (`PLAYBACK_TAIL_MS`, `audio-shell.ts:16,79-90`). A bare boolean would reopen the mic into the speaker tail. |
| §2.5 `os/audioDevices.ts`, `svcl.exe`, `pactl` | Obviated — see the finding above. Never mutate the user's system defaults for a problem our own audio layer solves locally. |
| §3 `tools/voiceTools.ts` (`speak`) | **`speak` already exists**, fully wired: `apps/local-api/src/routes/voice/index.ts:38-46` (`x-mcp`, `rootSurface: true`, `mutatingApproved: true`) → `speak-through-daemon.ts` → daemon. Re-registering would bypass the generated MCP registry. The guide's "keep it out of allowedTools" advice also contradicts our shipped decision. |
| §5 ffmpeg for capture | We already produce 16 kHz mono in pure JS off node-cpal (`audio-shell.ts:101-113`). |
| §5 `OnlineRecognizer` streaming STT | Optional latency upgrade only — **not** required for calls. Our silero-VAD endpointing already yields closed utterances. Adopting it means new `.d.ts` surface, a new `SttModelConfig` variant, a new mapper, and a new model download. Treat as out of scope unless latency proves unacceptable. |

---

## Part A — device selection (START HERE; no decisions needed, ships standalone)

Valuable on its own, independent of calls: *"choose which microphone and speaker Vynel uses"* is a
normal feature. Unblocked.

1. **Expose enumeration.** Add `getHosts()` / `getDevices(hostId?)` to the `CpalNative` interface
   (`apps/voice/src/audio/cpal.ts:29-44`), typed against the runtime. Add a `findDeviceByName`
   resolver so a human-readable name (e.g. `"CABLE Output (VB-Audio Virtual Cable)"`) resolves to a
   `deviceId`. Handle "device not found" as an actionable error, not a crash — a cable that isn't
   installed must not take down the daemon.
2. **Parameterise the shell.** `createAudioShell` currently hardcodes
   `cpal.getDefaultInputDevice()` / `getDefaultOutputDevice()` (`apps/voice/src/audio/audio-shell.ts:32-35`).
   Accept optional input/output device ids, defaulting to today's behaviour so nothing regresses.
   New env vars go in `apps/voice/src/env.ts` — **the single sanctioned `process.env` site**
   (house rule: no `process.env` outside an app's Zod-validated `env.ts`).

Ship Part A green with tests before touching Part B.

---

## Part B — actually being in a call (HELD pending two Chad decisions)

**Do not start until these are answered. They are product/legal calls, not engineering defaults:**

- **Call-recording consent.** Capturing other participants' audio for STT triggers recording-consent
  law in many jurisdictions. Nothing in the codebase models "we are in a call", so there is
  currently nowhere to hang a disclosure.
- **Speaking as the user in meetings** is a materially different risk class from "drives the user's
  own desktop."

The work itself, once unblocked:

3. **A second capture stream** for the call's audio (Cable B), with its own VAD instance.
   `audio-shell.ts:96` opens exactly **one** input stream today.
4. **Output fan-out.** `audio-shell.ts:44` opens exactly **one** output. Speaking into the cable
   while the user still monitors locally is a two-sink write that does not exist. Note `emitAudio`
   (`:68-78`) assumes a single `outputConfig` for resample/upmix — that becomes per-sink.
5. **Duplex turn-taking — the deep one.** `voice-session-driver.ts:101` drops **all** inbound audio
   while `'busy'`/`'handed-off'`. In a call you must keep hearing participants while Vynel speaks,
   and be able to cut it off. **One change serves two features:** call duplex *and* the missing
   human barge-in (`voice-session-driver.ts:18-19` says outright *"v1 has no user barge-in"*).
   ⚠ It also removes the current echo defense (the drain-based mic reopen,
   `audio-shell.ts:79-90`) — a separate cable gives physical isolation on Cable B, so the guard
   should become **per-stream, not global**. This deserves care; don't rush it alongside plumbing.
   ⚠ Do **not** mistake `shouldBargeInNow` (`packages/voice/src/turn-taking/barge-in.ts:13`) for
   this — it is the opposite direction (assistant injects a queued notification when nobody is
   talking) and is dormant.
6. **A call turn policy — a design decision, not a file edit.** Wake-gating assumes one user
   addressing one assistant; in a multi-party call, "every utterance after wake is a command"
   (`voice-session-driver.ts:229-234`) fires on cross-talk. Decide the trigger — name-addressed
   only? host-only? — before writing code.

### Out of scope for this worktree

7. **Deep-link joining** (`zoommtg://…`, `msteams:`, `discord://`) is **structurally blocked**, not
   merely absent: `launch_app` takes an installed-app *name*, unconditionally prepends
   `shell:AppsFolder\` (`packages/desktop-control/src/apps/launch-app.ts:58`), and its validator
   rejects `&` (`:29`) — so a Zoom link fails on the query string alone. It needs a separate
   scheme-allowlisted URI primitive **in `packages/desktop-control`**, which the desktop worktree
   owns. **Do not touch `packages/desktop-control` from this worktree** — it is the one file both
   arcs would want. For now the vision loop clicking "Join with Computer Audio" works fine.

---

## Environment notes

- **Virtual cables are install/config, not code.** Windows: VB-Cable (Cable A) + VoiceMeeter or the
  A+B pack (Cable B). The guide's §2.2 call-app settings (disable AGC / noise suppression;
  Discord = Voice Activity, not Push-to-Talk) are real and worth following — AGC mangling TTS
  onsets is the #1 "why does it sound broken" cause.
- **Latent cross-platform bug worth fixing cheaply:** `sherpa-onnx-node` needs its native lib on the
  loader path (`LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH`); no such preamble exists in
  `apps/voice/package.json` or the root. Invisible on Windows (DLLs sit beside the `.node`), will
  bite on Linux/macOS.
- House rules that apply: TypeScript strict ESM with `.js` on every relative import · files ≤ ~300
  lines · functional repositories · every change ships its tests · **never auto-run the full
  `pnpm test` gate** (targeted typecheck + vitest; let Kafi call the gate) · no
  `Co-Authored-By: Claude` trailer on commits.
- `CHANGELOG.md` will conflict between the two worktrees at merge. Cheap; just expect it.

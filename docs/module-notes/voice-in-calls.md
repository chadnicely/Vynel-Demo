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
| Capture | `node-cpal`, env-selectable device (Part A) else default input, downmix+resample to 16 kHz in pure JS | `apps/voice/src/audio/audio-shell.ts:111-128` |
| Segmentation | sherpa **silero-VAD**, 16 kHz fixed, 30 s ring buffer | `packages/voice-engine/src/sherpa/sherpa-voice-activity-detector.ts:19-44` |
| STT | sherpa **`OfflineRecognizer` + Moonshine**, one-shot per closed segment, `decodeAsync` | `packages/voice-engine/src/sherpa/sherpa-speech-recognizer.ts:14-28` |
| Wake | pure regex `detectWakeWord` | `packages/voice/src/turn-taking/wake-word.ts:37-42` |
| Brain | `POST {VYNEL_API_URL}/root/turn` SSE | `apps/voice/src/brain/run-brain-turn.ts:50-53` |
| TTS | sherpa **`OfflineTts`** (Kokoro default, 11 voices), **`generateAsync`** — already off-thread | `packages/voice-engine/src/sherpa/sherpa-voice-engine.ts:25,33-38` |
| Pipelining | `SpokenSentenceBuffer` — per-sentence synth+play, already pipelined | `packages/voice/src/relay/sentence-buffer.ts:13-37` |
| Playback | `node-cpal`, env-selectable device (Part A) else default output, in-memory `Float32Array` straight to the stream | `apps/voice/src/audio/audio-shell.ts:59,83-92` |

The native sherpa addon is quarantined to exactly one file **by design**:
`packages/voice-engine/src/sherpa/native.ts:1-9`.

---

## The finding that shapes this work (verified live, not read off docs)

`node-cpal` exposes device enumeration at runtime, and our own corrected binding **already types
`deviceId` as `createStream`'s first argument** (`apps/voice/src/audio/cpal.ts:54-59`):

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
| §1 `isSpeaking()` boolean | We already have a richer gate: driver state `'busy'` drops mic frames (`voice-session-driver.ts:101`) **plus** a playback-drain estimate (`PLAYBACK_TAIL_MS`, `audio-shell.ts:17,94-105`). A bare boolean would reopen the mic into the speaker tail. |
| §2.5 `os/audioDevices.ts`, `svcl.exe`, `pactl` | Obviated — see the finding above. Never mutate the user's system defaults for a problem our own audio layer solves locally. |
| §3 `tools/voiceTools.ts` (`speak`) | **`speak` already exists**, fully wired: `apps/local-api/src/routes/voice/index.ts:38-46` (`x-mcp`, `rootSurface: true`, `mutatingApproved: true`) → `speak-through-daemon.ts` → daemon. Re-registering would bypass the generated MCP registry. The guide's "keep it out of allowedTools" advice also contradicts our shipped decision. |
| §5 ffmpeg for capture | We already produce 16 kHz mono in pure JS off node-cpal (`audio-shell.ts:112-127`). |
| §5 `OnlineRecognizer` streaming STT | Optional latency upgrade only — **not** required for calls. Our silero-VAD endpointing already yields closed utterances. Adopting it means new `.d.ts` surface, a new `SttModelConfig` variant, a new mapper, and a new model download. Treat as out of scope unless latency proves unacceptable. |

---

## Part A — device selection (START HERE; no decisions needed, ships standalone)

> **Status: LANDED in this worktree.** Enumeration typed against a fresh live probe (hosts carry
> `id`, not `hostId`), pure `findDeviceByName`/`resolveAudioDevices` in
> `apps/voice/src/audio/device-selection.ts` (missing device = loud error + default fallback, never
> a crash), `createAudioShell` takes an optional selection, env vars
> `VYNEL_VOICE_INPUT_DEVICE`/`VYNEL_VOICE_OUTPUT_DEVICE`. 8 tests; voice-daemon suite 59/59.

Valuable on its own, independent of calls: *"choose which microphone and speaker Vynel uses"* is a
normal feature. Unblocked.

1. **Expose enumeration.** Add `getHosts()` / `getDevices(hostId?)` to the `CpalNative` interface
   (`apps/voice/src/audio/cpal.ts:45-62`), typed against the runtime. Add a `findDeviceByName`
   resolver so a human-readable name (e.g. `"CABLE Output (VB-Audio Virtual Cable)"`) resolves to a
   `deviceId`. Handle "device not found" as an actionable error, not a crash — a cable that isn't
   installed must not take down the daemon.
2. **Parameterise the shell.** `createAudioShell` currently hardcodes
   `cpal.getDefaultInputDevice()` / `getDefaultOutputDevice()` (`apps/voice/src/audio/audio-shell.ts:32-50`).
   Accept optional input/output device ids, defaulting to today's behaviour so nothing regresses.
   New env vars go in `apps/voice/src/env.ts` — **the single sanctioned `process.env` site**
   (house rule: no `process.env` outside an app's Zod-validated `env.ts`).

Ship Part A green with tests before touching Part B.

---

## Part B — actually being in a call (building is a GO — Kafi 2026-08-11)

**Kafi's direction (2026-08-11): focus on building the functionality.** The two product/legal
questions below stay flagged for **Chad's sign-off before real-world calls with other people**, but
they no longer block engineering — the mechanism carries them as primeable steps:

- **Call-recording consent.** Capturing other participants' audio for STT triggers recording-consent
  law in many jurisdictions. Part C's call lifecycle is where "we are in a call" now lives; the
  disclosure line is a priming step at join (recommended default: always announce). Chad picks the
  wording and the default before live use.
- **Speaking as the user in meetings** is a materially different risk class from "drives the user's
  own desktop." Recommended stance (pending Chad): Vynel always identifies as an assistant, never
  impersonates the user.

The work itself, once unblocked:

3. **A second capture stream** for the call's audio (Cable B), with its own VAD instance.
   `audio-shell.ts:111` opens exactly **one** input stream today.
4. **Output fan-out.** `audio-shell.ts:59` opens exactly **one** output. Speaking into the cable
   while the user still monitors locally is a two-sink write that does not exist. Note `emitAudio`
   (`:83-92`) assumes a single `outputConfig` for resample/upmix — that becomes per-sink.
5. **Duplex turn-taking — the deep one.** `voice-session-driver.ts:101` drops **all** inbound audio
   while `'busy'`/`'handed-off'`. In a call you must keep hearing participants while Vynel speaks,
   and be able to cut it off. **One change serves two features:** call duplex *and* the missing
   human barge-in (`voice-session-driver.ts:18-19` says outright *"v1 has no user barge-in"*).
   ⚠ It also removes the current echo defense (the drain-based mic reopen,
   `audio-shell.ts:94-105`) — a separate cable gives physical isolation on Cable B, so the guard
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

## Part C — the brain (settled with Kafi 2026-08-11; zero new session primitives)

The model: **global conducts · a per-call session communicates · the daemon is the body.** The wake
line stays the user's private channel to global and is untouched — call loops are additive instances
in the same daemon; the primary channel never learns calls exist.

- **Conductor.** Global gets the call tools — `start_call` / `list_calls` / `end_call` + a target
  param on the existing `speak` (`local | call:<id>`; never a second speak tool — the note's §3
  rejection stands). v1 ships them as `rootSurface` tools behind `featureGate('voice')`, the shipped
  `speak` precedent (`apps/local-api/src/routes/voice/`). `start_call` is mutating → cards in ask
  mode. Promotion to a catalog capability (`scope: 'global'` joins `CapabilityScope` + a global
  toggle surface — a deliberate schema move; today `workspace_capabilities` rows are hard children
  of a workspace and global resolves `defaultEnabledCapabilityIds()`) is bundled with Chad's consent
  sign-off: the user-visible toggle IS the consent artifact.
- **Communicator.** One **spawned session per call**, primed with goal / attendees / mode /
  disclosure line; pins a fast model (the voice-triage Haiku precedent). Two modes, set by the user
  through global in plain conversation, carried in the priming: **notetaker** (group default —
  transcript batches into the session without a turn per utterance; turns fire on name-address or
  batch review) · **participant** (1:1 — every completed utterance runs a turn). Escalation upward =
  session-comms `update`; global answers by delegating back down or `speak(call:id)`. The session's
  own read-only cross-session search/read tools cover lookups without a round-trip.
- **Body.** Daemon **call registry** `callId → { cable pair, VAD instance, session id, mode }` — N
  calls by design, concurrency bounded by installed cable pairs (a config inventory, not a code
  limit). Call turns run against the spawned session's direct-chat route, **not** `/root/turn`.
- **Lifecycle.** "Join my 9 pm call" = the **schedules feature** fires a global turn at 9 pm — zero
  scheduling code here, the daemon has no clocks. Call end = global's `end_call` **or** a daemon
  silence/stream-death timeout (a closed Zoom window must never leave a zombie session) → the
  session delivers its `report` upward (summary, action items) → global narrates it on the user's
  thread. Management is the session library as-is: listed from birth, watchable live mid-call,
  stoppable, searchable forever.

Build order (status 2026-08-11): **B1 LANDED** `1be8903` — capture-stream home, N-instance ·
**B2 LANDED** `d15a9c5` — output-sink home, per-sink keepalive/drain · **B3 slimmed + LANDED** —
the barge-in primitive `OutputSink.cutPlayback()` (close+reopen is the only true discard;
`pauseStream` would replay the cut tail; stale-drain guarded). The cancellable sentence-speaker
extraction and the call-side duplex/onset-cancel policy **fold into C2**, where their consumer (the
call loop) is born — Cable B is physically echo-free (it carries only remote participants), so the
call feed is never busy-gated and its barge-in needs no echo discrimination. **Primary-line human
barge-in is DEFERRED to live-tune with a real mic**: the open mic hears the daemon's own speaker,
so enabling it naively means TTS interrupting itself — that needs echo discrimination, not
plumbing. → C1 conductor tools + call registry (single-call, registry-shaped) → C2 communicator
(line-speaker home + onset cancel + priming/modes/report bookends) → C3 multi-call (cable-pair
inventory).

---

## Environment notes

- **`/calls` inherits the overlay channel's open CORS** (loopback-bound, Phase-1 unauthenticated —
  same standing posture as `/speak`). Any local page can read call labels/ids and POST. Recorded
  here so the Phase-2 auth sweep covers the call surface too.
- **Virtual cables are install/config, not code.** Windows: VB-Cable (Cable A) + VoiceMeeter or the
  A+B pack (Cable B). The guide's §2.2 call-app settings (disable AGC / noise suppression;
  Discord = Voice Activity, not Push-to-Talk) are real and worth following — AGC mangling TTS
  onsets is the #1 "why does it sound broken" cause.
- **Latent cross-platform bug worth fixing cheaply:** `sherpa-onnx-node` needs its native lib on the
  loader path (`LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH`); no such preamble exists in
  `apps/voice/package.json` or the root. Invisible on Windows (DLLs sit beside the `.node`), will
  bite on Linux/macOS. *(Deliberately NOT folded into Part A — a cross-platform fix needs a small
  launcher script, not an env one-liner in package.json; do it as its own chore when Linux/macOS
  support matters.)*
- House rules that apply: TypeScript strict ESM with `.js` on every relative import · files ≤ ~300
  lines · functional repositories · every change ships its tests · **never auto-run the full
  `pnpm test` gate** (targeted typecheck + vitest; let Kafi call the gate) · no
  `Co-Authored-By: Claude` trailer on commits.
- `CHANGELOG.md` will conflict between the two worktrees at merge. Cheap; just expect it.

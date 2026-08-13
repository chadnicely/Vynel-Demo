# Vynel virtual audio devices — handover brief (night-automation ready)

**Self-contained brief for a fresh session.** Commissioned by Kafi 2026-08-11 after the
voice-in-calls arc merged (`37cb352`). Read `docs/module-notes/voice-in-calls.md` first — this
brief builds on its shipped machinery and vocabulary.

## The goal

Replace third-party virtual audio cables (VB-Cable / VoiceMeeter) with **Vynel's own virtual
audio devices**, so that:

1. **Free for every user** — no donation-paid cable packs, ever.
2. **The user's setup is never changed** — no default-device mutation (already guaranteed by the
   calls arc: we address devices by id), no extra third-party apps that must keep running.
3. **No license fight** — nothing redistributed, nothing GPL-derived, nothing needing a
   VB-Audio agreement.
4. **Multiple devices → multiple concurrent calls** — the driver exposes N cable pairs (ideally
   creatable on demand), feeding the registry's existing pair inventory
   (`apps/voice/src/call/call-registry.ts` — N-shaped since C1, inventory since C3). This is the
   requirement the free third-party stack can never meet: free VB-Cable is ONE cable.

**The interim product path stands regardless:** guided onboarding of the free stack (base
VB-Cable + VoiceMeeter, user installs from VB's site, Vynel detects + configures). This driver
work is the endgame that deletes the install step; do not block the interim path on it.

## The decomposition that shrinks the problem

A call needs two directions, and they are NOT equally hard:

- **Ears (call app → Vynel)** may need NO device at all: Windows supports user-mode
  **process-specific loopback capture** (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`,
  Win10 2004+) — capture ONE app's audio (just Zoom) with no cable, no driver, no admin.
  ⚠ VERIFY FIRST + it needs a small native addon (node-cpal does not expose loopback).
  macOS system-audio capture rules changed around Sequoia (Core Audio taps / new permission) —
  verify current state before relying on it.
- **Voice (Vynel → the call app's microphone)** is the part that genuinely requires a virtual
  capture device other apps can select — that is "the driver" per OS below.

If process loopback verifies, Windows ships with **half the driver surface** (voice-out only).

## Per-OS reality

| OS | What "our own devices" means | Signing/distribution | Multi-device |
|---|---|---|---|
| **Linux** | **No driver at all.** PipeWire/PulseAudio null-sinks created AT RUNTIME (`pactl load-module module-null-sink`) — Vynel's daemon creates one pair per call, deletes on end. | none | inherently dynamic |
| **macOS** | **User-space AudioServerPlugIn** (Core Audio HAL plugin, `/Library/Audio/Plug-Ins/HAL/`). NO kext, no reboot, no SIP dialog; coreaudiod restart on install. One plugin can publish N devices. | normal Developer ID + notarization (already needed for the app) | N devices in one plugin |
| **Windows** | **Kernel-mode audio driver** — the hard one. Start from Microsoft's **sysvad** sample (MIT; literally a virtual audio device with multiple endpoints) and evaluate **ACX** (the modern KMDF audio class framework) as the base. Static N pairs first; dynamic later. | **attestation signing** via Partner Center (EV cert required on the account). Cross-signed kernel drivers lost default trust in the April 2026 Windows update — attestation is the only path. InfVerif `/h` is enforced on submissions; SBOMs land H2 2026. | sysvad demonstrates multiple endpoints in one driver |

**License hygiene (hard rule):** BlackHole, SoundFlower, BackgroundMusic are GPL — read their
IDEAS, never their code. Clean-room from Microsoft's samples (MIT) and Apple's own
AudioServerPlugIn sample only.

## Phases for the night automation

An autonomous session on Kafi's Windows machine can do P0–P2 and P4 without a human:

- **P0 — verify the flagged claims.** Process-loopback capture viability (+ what addon exposes
  it); ACX-vs-sysvad for a VIRTUAL device in the current WDK (ACX samples may still assume real
  hardware — check); macOS capture-permission state (docs-only from Windows).
- **P1 — Windows spike.** Install the WDK toolchain; build **sysvad unmodified**; then brand a
  minimal fork: ONE "Vynel Call 1" mic+speaker pair, test-signed. Deliverables: a building
  driver repo (separate from the monolith — decide `drivers/` in-repo vs sibling repo and
  record why), a WRITTEN VM recipe for loading it (test-signing mode), and an honest effort
  read on N-pairs + dynamic creation. DO NOT attempt to load a test-signed kernel driver on the
  dev machine itself.
- **P2 — Linux runtime sinks.** Real code: a daemon-side seam that creates/destroys null-sink
  pairs per call on Linux (env-inventory stays the Windows path). Unit-shape it with fakes;
  integration needs a Linux box — mark it.
- **P3 — macOS AudioServerPlugIn spike.** NEEDS MAC HARDWARE — document the plan (Apple sample
  base, N devices, notarization), build nothing from Windows.
- **P4 — the inventory bridge.** Registry auto-discovery: devices named with a `Vynel Call`
  prefix are claimed as pairs automatically — no env vars once our devices exist (falls back to
  the env inventory). This lands in the monolith and is fully testable today with fake
  enumerations.

## P0 findings (2026-08-13 night run — claims verified against primary sources)

### P0.1 — process loopback: VERIFIED VIABLE; Windows needs the voice direction only

- API confirmed: `ActivateAudioInterfaceAsync` + `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`
  with include/exclude **process-tree** modes (child processes covered — Zoom's audio child is
  captured with the parent). Capture + shared mode only. The engine **converts to any requested
  format** (we can ask for mono float directly). The sample stamps Win10 2004; the headers
  document build 20348 — both below Vynel's floor either way.
- Integration caveat to validate in the addon spike: delivery is expected to be gap-y (packets
  only while the target renders); the VAD treats gaps as silence, so this shapes buffering, not
  viability.
- Addon landscape: **nothing production-grade exists.** `WerdoxDev/loopback-capture` (MIT,
  N-API/CMake, `start(pid, includeTree, cb)` → 48 kHz s16 stereo chunks) proves the shape at toy
  scale; `electron-audio-loopback` is system-wide-only and renderer-bound; node-cpal/RtAudio/
  PortAudio expose no process loopback. **Verdict: Vynel writes its own small N-API addon**
  (clean-room from Microsoft's MIT `ApplicationLoopback` sample; ~2–4 days incl. prebuilds),
  shaped like `CaptureStream` so the registry can adopt it as an alternate ears source without
  reshaping the call loop.
- **Consequence confirmed: the Windows driver only needs the voice direction** — ears is
  device-less per-app capture. One cable per call, not two.

### P0.2 — ACX vs sysvad: ACX is virtual-capable; AudioCodec is the better brand base

- Verified against the sample INF on `main`: **ACX `AudioCodec` installs `ROOT\AudioCodec`**
  (root-enumerated, devcon, zero hardware), Class=MEDIA, **speaker + microphone endpoints**,
  targets 10.0.19041+. The brief's "ACX samples may assume real hardware" worry is unfounded.
- `DriverSettings.h` centralizes every GUID/name with an explicit "replace these" note — the
  sample is **designed for rebranding**, and it's ONE driver project (sysvad: 8 projects + APO
  machinery; SimpleAudioSample: 5).
- Family precedents (MIT, ideas + reference — NOT GPL): `VirtualDrivers/Virtual-Audio-Driver`
  (MIT + MS-PL, SimpleAudioSample-derived speaker+mic, ships test-signed beta — proves indie
  teams ship this shape; nobody in OSS attestation-signs yet) · `JannesP/AudioMirror` (MIT,
  sysvad-derived, **implements render→capture loopback** — the exact cable wiring our endgame
  needs; unfinished, but a legitimate design reference).
- **P1 base decision: brand ACX AudioCodec** (modern framework Microsoft invests in, current
  INF style for InfVerif `/h`, one project, brandable-by-design). SimpleAudioSample is the
  fallback brand if ACX fights the EWDK; sysvad still builds unmodified first as the toolchain
  gate per the brief. Loopback-wiring effort reads comparable in both families (ACX: render and
  capture circuits share one device context — share a ring buffer; sysvad-family: AudioMirror
  is the existence proof).

### P0.3 — macOS: taps are the ears path; the Sequoia scare is characterized, not a kill

- Core Audio process taps (introduced 14.2, practical floor **14.4+**): PID →
  `kAudioHardwarePropertyTranslatePIDToProcessObject` → `CATapDescription` →
  `AudioHardwareCreateProcessTap` → aggregate device (`kAudioAggregateDeviceTapListKey`) →
  IOProc. Per-app capture confirmed (AudioCap reference implementation).
- Permission: `NSAudioCaptureUsageDescription` — its own TCC category ("System Audio Recording
  Only"), separate from mic AND from Screen Recording. **Needs a stable signing identity** —
  unsigned dev builds never fire the prompt (P3 dev-loop note).
- Sequoia: the **monthly re-approval nag is confirmed only for the Screen & System Audio
  Recording (screen-capture bypass) category**; no current reporting shows it for audio-only
  taps — verify live in P3. The "HAL-plugin capture broken on Sequoia" report is an
  AVCaptureSession **initialization-order change** (start the session before selecting the
  device; FB15620713) with a working workaround — BlackHole-style devices still function.
- Voice direction unchanged: user-space AudioServerPlugIn + Developer ID + notarization, no
  kext. P3 still needs Mac hardware.

### P1a — toolchain decision for this box

Windows 11 Pro 26200, zero VS/MSBuild/WDK installed. Chosen: **EWDK Windows 11 26H1 (July
2026, VS BuildTools 18.3.0, MSVC 14.50)** — a mount-and-run ISO: no install, no admin, no
UAC-prompt hang risk unattended, no system mutation, deletable when done. Lives at
`E:\KLONE\Toolchains\`. Fallback if samples fight the VS2026 toolset: the samples repo's
per-WDK release tags, or EWDK 26100.6584 (VS2022 era) from Other WDK Downloads.

**Needs humans/Chad:** Partner Center account + EV certificate (cost + identity — pairs with
the deferred Azure signing work), macOS hardware, the eventual bundle-vs-guided-install call
for OUR driver (ours = no third-party license, so bundling becomes purely a signing question).

## Never

Copy GPL driver code · rely on cross-signing (dead April 2026) · ship a kext · bundle VB-Audio
binaries · regress the guided free-stack path (it ships first regardless) · load test-signed
kernel drivers on the dev machine (VM only).

## Sources (verified 2026-08-11)

- ACX overview — learn.microsoft.com/windows-hardware/drivers/audio/acx-audio-class-extensions-overview
- sysvad sample — github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- Attestation signing + EV requirement — learn.microsoft.com/windows-hardware/drivers/dashboard/code-signing-attestation · code-signing-reqs
- Cross-signing trust removal (April 2026) — techcommunity.microsoft.com "Advancing Windows driver security: removing trust for the cross-signed driver program"
- AudioServerPlugIn precedent (user-space, no kext) — existential.audio/blackhole (GPL — ideas only) · github.com/kyleneideck/BackgroundMusic DEVELOPING.md

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

### P0.1 — BUILT + LIVE-VERIFIED (2026-08-14): the ears addon exists

The verdict above is now code. `apps/voice/native/process-loopback/` is a dependency-free N-API
addon (clean-room from the MIT ApplicationLoopback sample — no WIL/WRL/Media Foundation, which
the EWDK's msbuild can't NuGet-restore anyway): one refcounted completion handler + one capture
thread on the WASAPI event + a non-blocking, unref'd thread-safe function. Builds with the same
EWDK (`build.cmd` auto-detects the MSVC x64 toolset + SDK version; node headers/lib staged under
`Toolchains/node-headers/`). TS boundary `src/audio/process-loopback.ts` soft-loads it (absent
off-Windows / until built → the seam throws and the caller falls back to a cable), and
`src/audio/process-loopback-capture.ts` adapts it to `CaptureStream` byte-for-byte like
`openCaptureStream` (downmix → resample → 16 kHz mono). 6 seam tests on a fake addon; 162 green.
**Live smoke passed**: captured a 440 Hz tone from a real PID (peak 0.24, rms 0.17, non-silent),
399 frames over 3.99 s at 48 kHz stereo. NOT yet wired into the call registry as an ears source —
that lands with the loopback-driver milestone (the voice half), when a Windows call becomes one
cable + this addon.

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
`E:\KLONE\Workspace\Toolchains\`. Fallback if samples fight the VS2026 toolset: the samples repo's
per-WDK release tags, or EWDK 26100.6584 (VS2022 era) from Other WDK Downloads.

## Night-run results (2026-08-13, autonomous — branch worktree-virtual-audio-driver)

- **P0 — DONE** (findings above; `99edb5f`).
- **P1 — DONE as a spike.** Toolchain: EWDK 26H1 (28000.2526) at `E:\KLONE\Workspace\Toolchains\`
  (mount-and-run ISO; the machine itself unmutated). Release x64 builds: sysvad kernel driver +
  libs GREEN — only the three wil-dependent user-mode APO effect samples fail (the EWDK's
  msbuild cannot NuGet-restore PackageReference; irrelevant to our path) · ACX AudioCodec
  unmodified GREEN, zero errors · **the branded fork GREEN** (`drivers/windows/
  vynel-call-audio`, `c129217`): `VynelCallAudio.sys` + catalog **test-signed** (WDKTestCert,
  `.cer` exported by the build), **InfVerif `/h` VALID**, endpoints "Vynel Call 1
  Speaker/Microphone" on `ROOT\VynelCallAudio`, every `.cpp` byte-identical to the MIT sample
  (mechanically diffed). VM-only loading recipe: `drivers/windows/vynel-call-audio/LOADING.md`;
  nothing was loaded on this machine (hard rule kept). **Effort read:** loopback wiring (makes
  it a real cable, adds the Ears/Voice ends) = weeks-scale — both ACX circuits share one WDF
  device context, the ring is plain kernel code, format/clock matching is the care point ·
  N static pairs = days (INF models, same binary) · dynamic per-call pairs = ACX-supported
  (post-start `AcxDeviceAddCircuit` + a control IOCTL) — size it after loopback lands.
- **P2 — DONE in code; real-box integration marked.** `linux-null-sink-cables.ts` (`6560067`):
  boot-time pool behind `VYNEL_CALL_LINUX_PAIRS` (default 2), four pactl modules per pair named
  by the contract below, bounded destroy at shutdown, crash-reap at next boot; 10 tests on a
  scripted fake runner; reviewer clean (boot now hard-exits on failure — no half-booted daemon).
  OPEN on a real Linux box: does cpal's ALSA enumeration surface pulse device descriptions?
  (WSLg here has no pactl.) Worst case is a loud `device-missing` — never cross-bleed.
- **P4 — DONE.** `call-cable-discovery.ts` + keyed registry inventory (`dc8fffc`); reviewer
  clean; 13 new tests. Contract below.
- **P3 — untouched (needs Mac hardware), as briefed.**

## 2026-08-14 — the driver is a real cable (voice half) + Windows ears exist

Two milestones past the spike, both on `worktree-virtual-audio-driver`:

- **Ears addon** (`apps/voice/native/process-loopback`) — per-process WASAPI loopback, so a
  Windows call hears one app with NO cable. Built, live-smoke-verified (440 Hz tone off a real
  pid). Detail in its README + the P0.1 BUILT block above.
- **Loopback cable** (`drivers/windows/vynel-call-audio`) — the branded ACX driver is now a
  one-way virtual cable: a device-level spin-lock PCM ring (`Common/LoopbackRing.{h,cpp}`) that
  the render stream engine writes each played packet into and the capture stream engine reads
  back (silence on underrun), wired through the device context + both circuits' stream-create.
  Render endpoint renamed "Vynel Call 1 Voice"; capture stays "Vynel Call 1 Microphone".
  **Compiles + links clean into `VynelCallAudio.sys`; InfVerif `/h` VALID. Runtime-UNVERIFIED**
  (kernel driver → VM only, none here) — the reviewer + VM smoke are the remaining gates.
  Catalog gen (inf2cat) currently fails only on a local-vs-UTC build-clock skew ("postdated
  DriverVer"), documented in the driver README — not a code issue.

**The Windows call shape now:** ONE voice cable (this driver) + device-less ears (the addon) —
not two cables. v1 driver constraint: both endpoints must share one PCM format (daemon opens
both; mismatch = wrong-rate audio, not a crash) — in-driver resample is the recorded next
driver improve.

### Registry integration LANDED — a call's ears is a device OR a pid

The call registry now understands both models. A `CallCablePair`'s `inputName` (the capture
device) is **optional**: present = a two-device cable (env / Linux null-sinks); absent = the
Windows driver path, where the call is HEARD by **process-loopback of the call app's pid** and
the pair carries only its Voice render device. Discovery turns a "Vynel Call <n> Voice" device
with no matching Ears device into a loopback pair; `startCall` takes an optional `capturePid`
(required for a loopback pair, checked before the sink so a miss never orphans it) and opens the
process-loopback capture instead of a device stream. The voice sink was already
format-agnostic — it opens the driver's "Vynel Call 1 Voice" like any output device. The daemon
`POST /calls` surface accepts `capturePid`. 169 daemon tests green; reviewer-checked.

**No app detection needed (2026-08-14):** a loopback pair with NO `capturePid` now captures all
system audio EXCEPT the daemon's own process (process-loopback exclude-mode on our own pid) —
that IS the call participants, **echo-free** (Vynel's own voice, rendered by this process, is the
one thing excluded), with zero app detection. `capturePid` stays as a precise-targeting
refinement (that one app + its children, include-mode). **Live-verified on the dev box**:
exclude-self capture returned the tone from another process (peak 0.46) while excluding itself.
So the Windows call works out of the box — driver + addon, no cable, no pid.

Behavior flag for Chad: capturing "all system audio except Vynel" during a call is within the
call arc's consent envelope (explicit join + the disclosure line), but it does capture non-call
audio too (music, notifications). If that's not wanted, `capturePid` scopes it to the call app —
which needs the conductor to know the app's pid (a picker / app-detection, now OPTIONAL rather
than required).

## The cross-OS device-naming contract (settled this run)

One convention everywhere — the registry's auto-discovery (P4), the Linux null-sink pool (P2),
and the Windows driver endpoints (P1) all speak it:

| End | Name | Who uses it |
|---|---|---|
| Vynel records participants (capture) | `Vynel Call <n> Ears` | registry `inputName` |
| Vynel speaks into the call (render) | `Vynel Call <n> Voice` | registry `outputName` |
| the call app's microphone (capture) | `Vynel Call <n> Microphone` | user picks it in Zoom/Teams |
| the call app's speaker (render) | `Vynel Call <n> Speaker` | user picks it in Zoom/Teams |

Discovery matches `^vynel call (\d+) (ears|voice)\b` case-insensitively (Windows enumerates
"<endpoint> (<adapter>)", so matching is prefix-shaped), claims complete pairs only, and never
touches the app-facing ends. The P1 spike driver brands the two APP-facing names only (codec
shape: one speaker + one mic, unlooped) — it deliberately does NOT trip discovery; the endgame
looped driver adds the Ears/Voice ends. On Linux the pool publishes all four per pair via two
null-sinks + two remap-sources (`apps/voice/src/call/linux-null-sink-cables.ts`).

**Later-improves recorded (from the P4 review):** per-call create/destroy on Linux needs an
async `startCall` reshape — the boot-time pool ships first · real-Linux-box validation that
pulse device descriptions surface through cpal's ALSA enumeration (THE integration unknown,
marked) · held-pair identity per END by resolved deviceId (mid-call rename hole) ·
try-next-free-pair when the first free pair fails direction resolution (faithful pre-existing
semantics; discovery adds a new trigger surface).

## 2026-08-14 — the driver RAN on real hardware (loopback proven) + registry finds it

Loaded the test-signed driver on Chad's machine (test-signing on, Secure Boot off) via
`devcon install ... ROOT\VynelCallAudio`. **No BSOD; endpoints live; the loopback SMOKE PASSED** —
a 440 Hz tone played into the render endpoint came back out the capture endpoint at peak 0.300
(exactly the generated amplitude) sustained over 5 s. The `LoopbackRing` kernel code carries
audio end-to-end on real hardware. `smoke-cable.mjs` is the one-command proof (though it keys on
the pretty names — see below).

**Endpoint naming — the one rough edge.** Windows enumerates the endpoints as
`Speakers (VynelCallAudio Device)` / `Microphone (VynelCallAudio Device)`, NOT the contract
`Vynel Call 1 Voice/Microphone`. Windows composes an audio endpoint name as `<role> (<device>)`;
neither the INF `HKR,,FriendlyName` nor the ACX `EvtAcxPinRetrieveName` callback (both now set to
the contract names — they name the KS pin, kept as the right intent) overrides the `<role>` half.
Root-caused, not yet fixed — the proper mechanism (what VB-Cable uses for `CABLE Output`) is a
focused follow-up.

**So the registry recognizes the driver WITHOUT the pretty name** (`call-registry.ts`
`#discoverDriverLoopbackPairs`): a device carrying the brand marker `vynelcallaudio`
(whitespace-insensitive) whose render direction is confirmed by an output-config probe becomes a
loopback voice pair (ears = process-loopback). Locale-proof (probe, not the word "Speakers");
the app-facing capture endpoint shares the marker but fails the render probe, so it's never
claimed. Verified live: the probe cleanly split the two endpoints (render out=YES, capture
in=YES). 3 tests; 173 daemon tests green.

**Follow-ups:** ~~(1) proper endpoint friendly name~~ · ~~(2) prettier DeviceDesc~~ — both
LANDED 2026-08-14, see the endpoint-naming section below · (3) in-driver format tolerance (the
smoke passed only because a tone is channel-symmetric; real stereo→mono needs handling).

## 2026-08-14 — endpoint naming SOLVED (build-verified; runtime pass pending)

The mechanism (learn.microsoft "Friendly names for audio endpoint devices" + sysvad + the ACX
sample itself): Windows composes `<pin name> (<DeviceDesc>)`, resolving the pin name from the
**bridge pin's Name GUID** via `MediaCategories` — since Win10 1809 looked up FIRST in the
device software key (`HKR\MediaCategories`, universal-INF compliant; the global HKLM key is
legacy). This is what VB-Cable does for "CABLE Output". The ACX sample ships the code half
(`pinCfg.Name = MicCustomName`) but never the INF half — and our string-callback attempt named
the KS pin object, which the endpoint builder ignores (it reads the registry, not
`KSPROPERTY_PIN_NAME` strings). Root cause closed.

The fix, both halves now in sync:

- **Driver:** `pinCfg.Name = &MIC_CUSTOM_NAME` restored on the capture bridge pin; new
  `SPEAKER_CUSTOM_NAME` GUID (`c5dc38c1-46d7-41a9-a581-49a61e1e9faf`) threaded through
  `CodecR_AddStaticRender` → render bridge pin. Both `EvtAcxPinRetrieveName` callbacks deleted
  (dead mechanism, proven live).
- **INF:** `Audio_Device.EndpointNames.AddReg` maps both GUIDs to the contract names under
  `HKR,%MEDIA_CATEGORIES%\{guid},Name`; `DeviceDesc`/`StdMfg` → **"Vynel Audio"** / "Vynel"
  (Chad picked "Vynel Audio" for the parenthesis, matching the standard
  "<endpoint> (<adapter>)" shape in the Windows output picker). Expected display:
  **"Vynel Call 1 Voice (Vynel Audio)"** + **"Vynel Call 1 Microphone (Vynel Audio)"**.
- **Daemon: zero code change needed** — `discoverVynelCallPairs` already claims a Voice with no
  Ears as a loopback pair, and the composed names match its prefix pattern. The
  `vynelcallaudio` marker+probe path stays as the fallback for pre-rename installs (comment
  updated; the marker can't match the new names, so no double-claim). One new test pins the
  exact shipped names; `smoke-cable.mjs` already keys on the contract names and now just works.

Build: EWDK compile + link green, catalog generated, **InfVerif `/h` VALID**, signed with the
Vynel cert (0 errors). **Runtime pass with Chad:** devcon remove + FRESH install (endpoint
property stores persist per endpoint — an in-place update may keep the stale name), then check
the sound-settings names and re-run `smoke-cable.mjs`.

### Runtime round 1 (live, same day): mic renamed, render exposed the SPEAKER hardcode

Fresh install on Chad's machine: **"Vynel Call 1 Microphone (Vynel Audio)" ✓** — the GUID
mechanism works — but the render endpoint stayed **"Speakers (Vynel Audio)"** even after its
`MMDevices` cache entry was deleted and rebuilt (both MediaCategories entries verified present
in the device key; both GUIDs verified present in the .sys). Root cause, from Microsoft's
audio-endpoint-builder-algorithm doc: **speaker endpoints are hardcoded to the name
"Speakers" — "cannot be altered by your driver or a third-party application"**; the Name GUID
is never consulted for `KSNODETYPE_SPEAKER` bridge pins. This is why VB-Cable's render end
("CABLE Input") is not a speaker-category pin.

Fix (0.1.0.3, built + InfVerif VALID + signed): render bridge pin category →
`KSNODETYPE_LINE_CONNECTOR`. Consequences, both wanted: form factor "Line" (honest for a
cable), and line-out ranks below Speakers in default-device selection so Windows never
auto-prefers the cable. Daemon unaffected (it probes output-config, never the category).

Ops learnings, both encoded in `Reset-EndpointCache.ps1`: (1) endpoint names are composed once
at endpoint creation and cached in `MMDevices` — purge Vynel entries to force a re-compose;
(2) the script's service restart lives in a `finally` because its first version died on one
access-denied key BEFORE restarting Audiosrv and left the machine mute (delete failures are
per-key warnings now).

### Runtime round 2 (0.1.0.3): VERIFIED — naming closed

Fresh install on Chad's machine: **"Vynel Call 1 Voice (Vynel Audio)"** +
**"Vynel Call 1 Microphone (Vynel Audio)"**, both OK — and `smoke-cable.mjs` **PASS** (peak
0.300 = the generated amplitude), finding both endpoints by contract name, so registry
auto-discovery claims the voice cable with zero config. Follow-up #1 is done end to end.
The smoke also live-demoed follow-up #2's gap: the ends opened at 44100 Hz ×2 (render) vs ×1
(capture) and only passed because a tone is channel-symmetric — in-driver format tolerance is
the next driver improve.

## Signing: local now, attestation later (Chad 2026-08-14)

Attestation (Partner Center + EV) is DEFERRED — it's the signature for public/community
distribution. For our own build → load → test → improve loop we sign with **Vynel's own
self-signed cert**: `drivers/windows/vynel-call-audio/sign/` (`New-VynelTestCert.ps1` makes the
cert once per machine; `Sign-Driver.ps1` stamps a fixed past DriverVer — dodging the UTC
clock-skew — builds the catalog, signs `.sys` + `.cat`, verifies the signer is ours). Verified
this run: both files signed by `CN=Vynel Driver Test`, 0 errors; "untrusted root" off-VM is
expected (only a VM that imports `VynelDriverTest.cer` with test-signing on trusts it —
test-signed drivers never load on a normal machine, which is exactly why this can't ship to
users). The cert is per-machine; its public `.cer` is a gitignored artifact (no private key ever
committed). Attestation later just REPLACES the signtool step — the build/stamp/catalog stay.

**Needs humans/Chad:** Partner Center account + EV certificate — ONLY for community distribution
(our local signing above unblocks build/test now), macOS hardware, the eventual
bundle-vs-guided-install call for OUR driver (ours = no third-party license, so bundling becomes
purely a signing question).

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

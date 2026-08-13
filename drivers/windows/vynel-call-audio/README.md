# Vynel Call Audio — Windows virtual audio driver

Vynel's own virtual audio cable for voice-in-calls
(`docs/module-notes/virtual-audio-driver.md` is the commissioning brief + P0 findings). It is
now a **one-way loopback cable**: audio played into the render endpoint comes back out the
capture endpoint, so a call app reads Vynel's voice as its microphone. Branded from Microsoft's
ACX `AudioCodec` sample (MIT). **Compile-verified + InfVerif-clean; NOT yet runtime-tested** (a
kernel driver loads only in a VM — see `LOADING.md`).

## What it publishes

One root-enumerated device (`ROOT\VynelCallAudio`, install via devcon/pnputil — no hardware)
with two looped endpoints:

- **Vynel Call 1 Voice** (render — Vynel's daemon plays TTS into this; the registry's
  `outputName`)
- **Vynel Call 1 Microphone** (capture — the call app selects this as its mic and hears Vynel)

The cable is the render→capture ring in `Common/LoopbackRing.{h,cpp}`: the render stream engine
writes each played packet into a device-level spin-lock ring, the capture stream engine reads it
back (silence on underrun). One direction only — this is the VOICE half. The EARS half (hearing
participants) is device-less on Windows via the process-loopback addon
(`apps/voice/native/process-loopback`), so a Windows call needs just this one cable.

**Format constraint (v1):** both endpoints must run the same PCM format; Vynel's daemon opens
both ends and picks matching formats. A mismatch produces wrong-rate audio, not a crash.
In-driver resampling is a recorded later-improve.

This device does NOT publish the `Vynel Call 1 Ears/Voice` PAIR the registry auto-discovers
(that pattern is for the two-cable env model); the Windows integration claims this single voice
cable + the process-loopback addon. Wiring that into the call registry is the next seam.

## Why in-repo (`drivers/`), not a sibling repo

Decided this run: the endpoint names ARE a contract with `apps/voice`'s discovery + the Linux
pool — keeping the INF next to the code that parses its names prevents drift; one repo keeps
review/history whole (house ethos: modular monolith, no fragment repos). The directory is NOT a
pnpm workspace package — nothing in `apps/`/`packages/` may import it, turbo ignores it, and it
builds only with the EWDK (below). Revisit only if attestation/release cadence demands a
separate pipeline (that decision pairs with Chad's Partner Center work).

## Lineage & licenses

Forked from `microsoft/Windows-driver-samples` @ `717778a20ba4dd2440fe609f69153a1f8a64f597`,
`audio/Acx/Samples/{AudioCodec,Common,Inc,Shared}` (MIT — headers retained in every source
file). Changes are BRANDING ONLY (fresh GUIDs + names, zero functional code):

- `VynelCallAudio/Driver/VynelCallAudio.inf` — hardware id `ROOT\VynelCallAudio`, service +
  binary `VynelCallAudio.sys`, provider "Vynel", endpoint friendly names above,
  `DriverVer 0.1.0.0`
- `VynelCallAudio/Driver/DriverSettings.h` — fresh render/capture component GUIDs + mic pin
  GUID (a machine running the MS sample must never collide with ours), pool tag `uaCV`
- `Shared/Trace.h` — fresh WPP control GUID
- `VynelCallAudio/Driver/Resources.rc` — version strings
- project/solution renamed with a fresh project GUID; internal circuit names (`Speaker0`/
  `Microphone0`) deliberately unchanged so no `.cpp` differs from the sample

GPL virtual-audio drivers (BlackHole, SoundFlower, BackgroundMusic) are **ideas-only — no code
was read into this tree**. MIT design references for the loopback milestone:
`JannesP/AudioMirror` (sysvad-family render→capture ring) and `VirtualDrivers/
Virtual-Audio-Driver` (SimpleAudioSample-family branding precedent).

## Building (EWDK — no Visual Studio install)

1. Mount `E:\KLONE\Workspace\Toolchains\EWDK_26H1_ge.iso` (double-click, or
   `Mount-DiskImage -ImagePath ...`) — say it lands on `F:`.
2. `F:\LaunchBuildEnv.cmd`
3. In that shell:
   `msbuild E:\...\drivers\windows\vynel-call-audio\VynelCallAudio\Driver\VynelCallAudio.sln /p:Configuration=Release /p:Platform=x64`
4. Output: `VynelCallAudio\Driver\x64\Release\` → `VynelCallAudio.sys` + `VynelCallAudio.inf`
   + catalog, test-signed by the WDK's generated `WDKTestCert` (export the `.cer` for the VM).

> **Build-clock note:** the WDK auto-stamps `DriverVer` with the build machine's LOCAL date, and
> `inf2cat` rejects it as "postdated" if that local date is ahead of UTC (a machine a few hours
> into the next day UTC-wise). This fails catalog generation only — compilation, linking, and
> `InfVerif /h` all succeed. Build on a machine whose local date is not ahead of UTC, or bump the
> source `DriverVer` per release; the loopback build was verified this way (compile + link + INF
> VALID) on 2026-08-14.

**Never load this on a dev machine — VM only.** See `LOADING.md`.

## Status & next milestones (honest effort read)

- [x] builds, test-signs, InfVerif `/h` VALID (the brand spike)
- [x] **Loopback wiring** — render→capture ring (`Common/LoopbackRing`), compiles + links +
  InfVerif-clean. **Runtime-unverified** (needs a VM per `LOADING.md`): confirm audio played
  into "Vynel Call 1 Voice" is heard on "Vynel Call 1 Microphone", check latency + glitching,
  and verify the format assumption holds when the daemon opens both ends at 48 kHz.
- [ ] **In-driver format tolerance**: v1 assumes both ends share one PCM format; add a format
  check + resample so a mismatch degrades gracefully instead of playing wrong-rate audio.
- [ ] **N static pairs**: INF-models change (N device nodes, per-model friendly names, same
  binary) — days-scale, mostly INF + install UX.
- [ ] **Dynamic pairs** (create per call on demand): ACX supports post-start
  `AcxDeviceAddCircuit` — a control IOCTL from the daemon could add/remove circuit pairs at
  runtime. The architecturally-supported dream sysvad can't cleanly do; size after loopback
  lands.
- [ ] **Attestation signing** (ship-blocker): Partner Center + EV cert — Chad. Test-signed
  builds never leave VMs.

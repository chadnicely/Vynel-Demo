# Vynel Call Audio — Windows virtual audio driver (P1 spike)

Vynel's own virtual audio device for voice-in-calls
(`docs/module-notes/virtual-audio-driver.md` is the commissioning brief + P0 findings). This is
the **P1 spike**: a minimal brand of Microsoft's ACX `AudioCodec` sample proving we can build,
brand, and test-sign our own device — it is NOT yet a functional cable (the speaker renders to
nowhere, the microphone captures generated audio; the render→capture loopback wiring is the
next driver milestone).

## What it publishes

One root-enumerated device (`ROOT\VynelCallAudio`, install via devcon/pnputil — no hardware)
with two endpoints, named per the cross-OS contract in the module note:

- **Vynel Call 1 Speaker** (render — what the user picks as the call app's speaker)
- **Vynel Call 1 Microphone** (capture — what the user picks as the call app's mic)

The Vynel-facing `Vynel Call 1 Ears/Voice` ends arrive with the loopback milestone; this spike
deliberately does NOT trip the registry's auto-discovery (which claims Ears/Voice pairs only).

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

**Never load this on a dev machine — VM only.** See `LOADING.md`.

## Status & next milestones (honest effort read)

- [x] builds unmodified-sample-equivalent, test-signed (this spike)
- [ ] **Loopback wiring** (render→capture ring buffer, makes it a real cable): the two ACX
  circuits share one WDF device context, so the ring is plain kernel code — but stream-format/
  clock matching needs care. Weeks-scale, not days. Then add the Ears/Voice endpoints (second
  looped cable per pair) so discovery claims it.
- [ ] **N static pairs**: INF-models change (N device nodes, per-model friendly names, same
  binary) — days-scale, mostly INF + install UX.
- [ ] **Dynamic pairs** (create per call on demand): ACX supports post-start
  `AcxDeviceAddCircuit` — a control IOCTL from the daemon could add/remove circuit pairs at
  runtime. The architecturally-supported dream sysvad can't cleanly do; size after loopback
  lands.
- [ ] **Attestation signing** (ship-blocker): Partner Center + EV cert — Chad. Test-signed
  builds never leave VMs.

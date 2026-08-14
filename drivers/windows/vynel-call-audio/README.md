# Vynel Call Audio — Windows virtual audio driver

Vynel's own virtual audio cable for voice-in-calls
(`docs/module-notes/virtual-audio-driver.md` is the commissioning brief + P0 findings). It is
now a **one-way loopback cable**: audio played into the render endpoint comes back out the
capture endpoint, so a call app reads Vynel's voice as its microphone. Branded from Microsoft's
ACX `AudioCodec` sample (MIT). **Runtime-PROVEN on real hardware (2026-08-14, test-signing
mode, Chad at the keyboard): loaded clean, loopback smoke passed at the generated amplitude.**
The endpoint rename below it is compile+InfVerif-verified and awaits its own runtime pass.

## What it publishes

One root-enumerated device (`ROOT\VynelCallAudio`, install via devcon/pnputil — no hardware)
with two looped endpoints:

- **Vynel Call 1 Voice** (render — Vynel's daemon plays TTS into this; the registry's
  `outputName`)
- **Vynel Call 1 Microphone** (capture — the call app selects this as its mic and hears Vynel)

Windows composes an endpoint's display name as `<pin name> (<DeviceDesc>)`, resolving the pin
name from the bridge pin's **Name GUID** via the device software key's `MediaCategories`
(Win10 1809+ mechanism — the same one VB-Cable uses for "CABLE Output"). So the INF's
`Audio_Device.EndpointNames.AddReg` maps the two GUIDs in `DriverSettings.h`
(`SPEAKER_CUSTOM_NAME` / `MIC_CUSTOM_NAME`, set as `pinCfg.Name` on each bridge pin) to the
names above, and `DeviceDesc` "Vynel Audio" fills the parenthesis: the user sees
**"Vynel Call 1 Voice (Vynel Audio)"**. A pin-name *callback* cannot do this — the endpoint
builder reads the registry, not `KSPROPERTY_PIN_NAME` strings (proven live on the pre-rename
build, which showed "Speakers (VynelCallAudio Device)"). GUIDs and INF entries must stay in
sync; the daemon pins the composed names in `call-cable-discovery.test.ts`.

**The speaker hardcode (proven live 2026-08-14):** a bridge pin categorized
`KSNODETYPE_SPEAKER` is force-named "Speakers" — per Microsoft's endpoint-builder docs, "the
name has been hardcoded … and cannot be altered by your driver or a third-party application";
the Name GUID is never consulted. So the render bridge pin is `KSNODETYPE_LINE_CONNECTOR`
instead (the VB-Cable-style shape): the custom name resolves, the form factor reads "Line",
and the cable's lower default-device rank means Windows never auto-prefers it over real
speakers — a property we want anyway (the calls arc never touches the user's defaults).
Endpoint names are composed ONCE at endpoint creation and cached under `MMDevices`;
`Reset-EndpointCache.ps1` purges Vynel endpoints so they rebuild after a naming change.

The cable is the render→capture ring in `Common/LoopbackRing.{h,cpp}`: the render stream engine
writes each played packet into a device-level spin-lock ring, the capture stream engine reads it
back (silence on underrun). One direction only — this is the VOICE half. The EARS half (hearing
participants) is device-less on Windows via the process-loopback addon
(`apps/voice/native/process-loopback`), so a Windows call needs just this one cable.

**Format tolerance:** the ring stores canonical mono 16-bit samples — the render side folds
its frames to mono (integer average), the capture side replicates to its channel count — so
the shipped stereo-Voice/mono-Microphone shape carries audio faithfully. Sample rate is never
converted: both circuits advertise **48 kHz only**, making a rate mismatch impossible by
construction (Windows converts shared-mode audio to the endpoint format; exclusive mode can
only pick advertised formats). Before this, the raw byte ring played stereo-into-mono at the
wrong pitch (`smoke-cable.mjs` measured ~40 Hz for a 440 Hz tone — overflow chop on top of
the half-pitch fold); the smoke now checks pitch, not just amplitude.

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
file). Beyond the loopback ring (`Common/LoopbackRing` + its stream-engine/circuit wiring) and
the endpoint-naming registration above, changes are branding (fresh GUIDs + names):

- `VynelCallAudio/Driver/VynelCallAudio.inf` — hardware id `ROOT\VynelCallAudio`, service +
  binary `VynelCallAudio.sys`, provider "Vynel", endpoint friendly names above,
  `DriverVer` 0.1.0.4 (bumped per package change; `sign/Sign-Driver.ps1` stamps the
  authoritative version with a fixed past date)
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
4. Output: `VynelCallAudio\Driver\x64\Release\VynelCallAudio\` → `VynelCallAudio.sys` +
   `VynelCallAudio.inf` + catalog. Sign it with Vynel's own cert via `sign/Sign-Driver.ps1`
   (`sign/README.md`) — that also sidesteps the DriverVer clock-skew below.

> **Build-clock note:** the WDK auto-stamps `DriverVer` with the build machine's LOCAL date, and
> `inf2cat` rejects it as "postdated" if that local date is ahead of UTC (a machine a few hours
> into the next day UTC-wise). This fails catalog generation only — compilation, linking, and
> `InfVerif /h` all succeed. Build on a machine whose local date is not ahead of UTC, or bump the
> source `DriverVer` per release; the loopback build was verified this way (compile + link + INF
> VALID) on 2026-08-14.

**Loading is a human decision, never autonomous.** The original hard rule was VM-only; Chad
chose to run it on his own machine (2026-08-14, test-signing on, work saved first — BSOD risk
accepted). Sessions never install/update the driver unattended. See `LOADING.md`.

## Status & next milestones (honest effort read)

- [x] builds, test-signs, InfVerif `/h` VALID (the brand spike)
- [x] **Loopback wiring** — render→capture ring (`Common/LoopbackRing`). **Runtime-PROVEN
  2026-08-14 on real hardware**: a 440 Hz tone into "Vynel Call 1 Voice" came back out the
  capture endpoint at the generated amplitude (peak 0.300, 5 s) — `smoke-cable.mjs`.
- [x] **Proper endpoint names** — MediaCategories pin-name GUIDs + DeviceDesc "Vynel Audio" +
  line-connector render category (mechanism + speaker hardcode above). **Runtime-VERIFIED
  2026-08-14 (0.1.0.3)**: both endpoints show the contract names and the smoke passes through
  them at the generated amplitude.
- [x] **In-driver format tolerance** — mono ring + channel fold/replicate + 48 kHz-only
  format lists (see "Format tolerance" above). **Runtime-VERIFIED 2026-08-15 (0.1.0.4)**:
  both ends open at 48000 and the pitch-checking smoke passes at 436.4 Hz (it FAILs on
  0.1.0.3 at the folded pitch).
- [ ] **N static pairs**: INF-models change (N device nodes, per-model friendly names, same
  binary) — days-scale, mostly INF + install UX.
- [ ] **Dynamic pairs** (create per call on demand): ACX supports post-start
  `AcxDeviceAddCircuit` — a control IOCTL from the daemon could add/remove circuit pairs at
  runtime. The architecturally-supported dream sysvad can't cleanly do; size after loopback
  lands.
- [ ] **Attestation signing** (ship-blocker): Partner Center + EV cert — Chad. Test-signed
  builds never leave VMs.

# Call audio — Follow-ups

> Open items for how a call gets its **ears** (hearing the meeting) and its **voice** (speaking into
> it): Vynel's own Windows audio driver (`drivers/windows/vynel-call-audio`), the per-process
> loopback addon (`apps/voice/native/process-loopback`), the Linux null-sink pool, and the cable
> inventory the call registry picks from (`apps/voice/src/call/`).
>
> **The `overview.md` / `structure.md` pair for this unit is not written yet.** This file exists on
> its own because there were findings to record now — and note that `_apps/voice`'s pair predates the
> calls arc entirely (it documents the wake loop and never mentions `apps/voice/src/call/`), so that
> pair is stale for this area too.
>
> Establishment markers, as in the [nodes register](../nodes/followup.md): **verified** (proven on
> real hardware), **reviewed** (found by a `code-reviewer` pass), **read** (traced in code, not
> executed).
>
> The full narrative — P0 research through the hardware smokes — is
> [`docs/module-notes/virtual-audio-driver.md`](../../../docs/module-notes/virtual-audio-driver.md).

Opened 2026-08-16, as the arc merged to main.

---

## How it works, in one chain

```
cpal.getDevices()          every audio endpoint the box has
  → #buildPairInventory    env vars + discovered "Vynel Call <n>" pairs, deduped by key
  → inventory.find(free)   first pair no live call holds; else 'pair-busy'
  → ears:  inputName present → device capture
           inputName absent  → process loopback (capturePid ? include-tree : exclude-self)
  → voice: openOutputSink on the pair's render end
```

The load-bearing asymmetry: **ears and voice are not the same problem.** Voice genuinely needs a
virtual capture device other apps can select — that is the driver. Ears needs no device at all on
Windows (per-process WASAPI loopback) and no driver at all on Linux (runtime null-sinks). So a
Windows call is **one cable plus an addon**, not two cables — which is why the driver only ever had
to publish the voice direction.

---

## Open items

### 1. One cable pair — a second concurrent call has no voice
**read** · `drivers/windows/vynel-call-audio/VynelCallAudio/Driver/VynelCallAudio.inf` (`[Models]`,
`KSNAME_Speaker="Speaker0"` / `KSNAME_Microphone="Microphone0"`) ·
`drivers/windows/vynel-call-audio/Common/LoopbackRing.h:11-14`

The INF publishes **one** device (`ROOT\VynelCallAudio`) carrying one speaker pin and one mic pin —
"Vynel Call 1" and nothing else. The software above it is already N-shaped (the registry has been
inventory-driven since C1, keyed since P4, and `pair-busy` is a real error path), so **the driver is
the whole constraint**: on Windows, call #2 fails to start.

This is the requirement the free third-party stack can never meet — free VB-Cable is one cable — and
it is stated goal #4 of the brief, the reason the driver exists at all. Everything else in the arc
shipped; this did not.

**Fix shape** — N *static* pairs first (per the P1 effort read, days not weeks: more INF models over
the same binary). Note the ring is **one instance per device context, shared by both circuits**
(`LoopbackRing.h:11-14`), so N pairs means N device contexts, each with its own ring — check that
holds before sizing. Dynamic per-call creation is ACX-supported (post-start `AcxDeviceAddCircuit` +
a control IOCTL) and should be sized only after static N lands.

### 2. Ears scoping now has a source — an app picker remains the richer future
**verified** (name→pid live on the dev box) · `apps/voice/src/call/capture-process-lookup.ts` ·
`apps/voice/src/call/call-endpoints.ts` · `packages/instructions/tool-descriptions/start_call.md`

Closed 2026-08-16 in substance: `start_call` takes `captureProcessName` ("chrome", "Zoom") — the
daemon resolves it to the root pid of the largest matching process tree and scopes include-tree
loopback there, and the tool description teaches the conductor to pass it whenever the hosting app
is known. `capturePid` stays as the raw form (give at most one of the two).

What remains open is the richer product surface: an app picker / desktop-control detection for when
the conversation never names the app, and Chad's consent-surface call on the unscoped default
(exclude-self still hears music and notifications).

### 3. Linux cables are a boot-time pool, not per-call
**reviewed** · `apps/voice/src/call/linux-null-sink-cables.ts`

The daemon creates `VYNEL_CALL_LINUX_PAIRS` pairs (default 2) at boot and destroys them at shutdown.
Per-call create/destroy — the shape that makes Linux concurrency unbounded and matches the "no setup"
promise best — needs an **async `startCall` reshape**, which is why the pool shipped first.

### 4. The Linux integration unknown is still unvalidated
**reviewed** · same file

Does cpal's ALSA enumeration surface Pulse device *descriptions*? If not, discovery never sees the
pool's four names and Linux calls fall back to `not-configured`. WSLg here has no `pactl`, so this
needs a real Linux box. Worst case is a loud `device-missing` — never cross-bleed — but it is the one
unknown that could make the whole Linux path inert.

### 5. A held pair is keyed by device *name*, not resolved id
**reviewed** · `apps/voice/src/call/call-registry.ts:78-86`

`pairKey` is built from the pair's device names so that an env entry duplicating a discovered pair
cannot double capacity, and so a held pair stays held across re-discovery. The hole: a device renamed
**mid-call** changes its key, so the next start no longer sees the pair as held and can hand it to a
second call.

Narrow — it needs a rename during a live call — but the failure is two calls sharing one cable, which
is the exact cross-bleed the inventory exists to prevent.

**Fix shape** — hold identity per END by resolved `deviceId` rather than by name.

### 6. A pair whose direction resolution fails is fatal, not skipped
**reviewed** · `apps/voice/src/call/call-registry.ts:138-139,162-163`

`startCall` takes the first pair no call holds, then resolves each end. If resolution throws, the
start fails — even when other free pairs would have worked.

Faithful pre-existing semantics, recorded because **discovery added a new trigger surface**: the
inventory can now contain pairs nobody vetted (a device that matched the name pattern but isn't
really a cable), where before it only held env vars a human typed.

**Fix shape** — try the next free pair on resolution failure; report the last error if all fail.

---

## Considered and correct — do not "fix" these

- **48 kHz only, both circuits.** The deliberate fork over an in-driver resampler: Windows converts
  all shared-mode audio to the endpoint format, and exclusive mode can only pick advertised formats,
  so a rate mismatch **cannot occur by construction**. Weeks of integer-resampler risk bought nothing.
- **The render pin is a line connector, not a speaker.** Speaker endpoints are hardcoded by Windows
  to the name "Speakers" (the endpoint builder never consults the Name GUID for them) — this is why
  VB-Cable's render end isn't a speaker either. Bonus: line-out ranks below speakers in default-device
  selection, so Windows never auto-prefers the cable.
- **Exclude-self is the default ears.** Capturing everything except our own pid is echo-free by
  construction — the one thing excluded is the voice we render — and needs no app detection.
- **The `vynelcallaudio` marker + render-probe discovery path.** Superseded by contract-name matching
  but kept deliberately, for installs that predate the rename. The marker can't match the new names,
  so there is no double-claim.
- **Non-16-bit formats park the cable** (write drops, read silences) rather than folding garbage.
  Unreachable through the advertised path; the guard is there so the failure is silence, not noise.
- **Test-signed only.** Attestation signing replaces the `signtool` step alone — the build, the
  DriverVer stamp, and the catalog all stay. Not a follow-up; it is
  [blocked on Chad](../../../docs/module-notes/virtual-audio-driver.md) (Partner Center + EV cert),
  as is P3 macOS (needs Mac hardware).

---
*Opened 2026-08-16 as `worktree-virtual-audio-driver` merged to main. Close an item by fixing it and
deleting the entry.*

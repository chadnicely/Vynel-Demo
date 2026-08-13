# process-loopback — per-process audio capture (Windows "ears")

Native N-API addon: capture ONE process's audio (Zoom, Teams, Meet-in-a-browser
tab) with **no virtual cable, no driver, no admin** — Windows per-app WASAPI
loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, Windows 10 2004+).

This is the **ears** half of a Windows call. Because Windows captures the call
app's audio per-process, only the **voice** direction (Vynel → the app's mic)
needs a real virtual device — so a Windows call needs ONE cable, not two.

## API (from `src/audio/process-loopback.ts`)

```
start(processId, includeProcessTree, onAudio) -> handle   // onAudio(Float32Array), 48kHz interleaved stereo
stop(handle)                                              // idempotent
captureSampleRate: 48000
captureChannels: 2
```

Frames are fixed 48 kHz / stereo / float32 (`AUTOCONVERTPCM` makes the engine
convert). Delivery is gap-y by design — packets only arrive while the target
renders audio; the VAD treats gaps as silence. Silent buffers are delivered as
zeros, never dropped. The TS seam (`src/audio/process-loopback-capture.ts`)
downmixes + resamples to 16 kHz mono `PcmAudio`, identical to device capture.

## Design notes

- **Dependency-free.** The Microsoft ApplicationLoopback sample (MIT) uses WIL +
  WRL + Media Foundation work queues; this addon uses none of them — a plain
  refcounted completion handler, one capture thread waiting on the WASAPI event,
  and a non-blocking N-API thread-safe function. Nothing to NuGet-restore, which
  the EWDK's msbuild can't do anyway.
- **Never holds the event loop open** — the tsfn is unref'd, so the daemon exits
  cleanly even mid-capture.
- **The capture thread solely owns the tsfn lifetime** — it releases on every
  exit path, so `start`/`stop` never race the release.

## Building

Requires the EWDK (mount-and-run, no VS install) — same toolchain as the driver.
Node headers + the win-x64 import lib for the runtime's node version come from
nodejs.org, staged under `Toolchains/node-headers/` (override `NODE_HEADERS_DIR`).

```bat
cmd /c "call <EWDK>:\BuildEnv\SetupBuildEnv.cmd && apps\voice\native\process-loopback\build.cmd"
```

Output `build/process-loopback.node` is gitignored — the TS seam loads it
softly (absent on Linux/macOS, absent until built → falls back to a cable feed).

## Live smoke

```bat
node apps\voice\native\process-loopback\smoke.mjs <pid> [seconds]
```

Verified 2026-08-14 on this box: captured a 440 Hz tone from a hidden
PowerShell player (peak 0.24, rms 0.17, `nonSilent: true`), 399 frames over
3.99 s at 48 kHz stereo. Exits non-zero if only silence is captured.

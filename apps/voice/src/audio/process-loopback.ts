import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

// The single, corrected boundary to the native process-loopback addon — the
// same one-file quarantine `cpal.ts` gives node-cpal. The addon captures ONE
// process's audio (Windows per-app WASAPI loopback), so a Windows call needs
// no virtual cable for its EARS direction. It's platform + build specific:
// absent on Linux/macOS and absent until built (native/process-loopback/
// build.cmd), so loading is soft — `loadProcessLoopback()` returns null rather
// than throwing, and the caller falls back to a cable feed.

export interface ProcessLoopbackAddon {
  /** Begin capturing `processId` (and its child processes when
   *  `includeProcessTree`). Delivers interleaved float32 frames at
   *  `captureSampleRate`/`captureChannels`. Throws if the pid can't be
   *  activated (dead pid, unsupported OS build). Returns an opaque handle. */
  start(
    processId: number,
    includeProcessTree: boolean,
    onAudio: (frame: Float32Array) => void,
  ): ProcessLoopbackHandle
  /** Stop a capture started with `start`. Idempotent. */
  stop(handle: ProcessLoopbackHandle): void
  readonly captureSampleRate: number
  readonly captureChannels: number
}

export type ProcessLoopbackHandle = unknown

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const addonPath = resolve(here, '..', '..', 'native', 'process-loopback', 'build', 'process-loopback.node')

let cached: ProcessLoopbackAddon | null | undefined

// Cached so a per-call resolver never re-probes the filesystem or re-loads the
// addon. `undefined` = not yet probed, `null` = unavailable here.
export function loadProcessLoopback(): ProcessLoopbackAddon | null {
  if (cached !== undefined) return cached
  if (process.platform !== 'win32' || !existsSync(addonPath)) {
    cached = null
    return cached
  }
  try {
    cached = require(addonPath) as ProcessLoopbackAddon
  } catch {
    // A load failure (ABI mismatch, missing system dll) must not take the
    // daemon down — the cable feed remains the ears path.
    cached = null
  }
  return cached
}

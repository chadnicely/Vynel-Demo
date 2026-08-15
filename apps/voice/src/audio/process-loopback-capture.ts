import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { downmixToMono, resampleLinear } from './audio-format.js'
import { CAPTURE_RATE, type CaptureStream } from './capture-stream.js'
import { loadProcessLoopback, type ProcessLoopbackAddon } from './process-loopback.js'

// A CaptureStream backed by per-process WASAPI loopback instead of a device —
// the Windows call's EARS with no virtual cable. Shaped identically to
// openCaptureStream (downmix → resample → 16 kHz mono PcmAudio) so the call
// registry consumes it through the exact same seam; only the source differs.

export interface ProcessLoopbackSource {
  /** The call app to capture (e.g. Zoom's audio process). */
  processId: number
  /** Capture child processes too — Zoom/Teams render audio from a child. */
  includeProcessTree?: boolean
}

// Injectable for tests; production resolves the native addon once.
export function openProcessLoopbackCapture(
  logger: Logger,
  label: string,
  source: ProcessLoopbackSource,
  onAudio: (audio: PcmAudio) => void,
  addon: ProcessLoopbackAddon | null = loadProcessLoopback(),
): CaptureStream {
  if (addon === null) {
    throw new Error(
      'process-loopback capture is unavailable — Windows-only and requires the native addon ' +
        '(apps/voice/native/process-loopback/build.cmd); use a cable feed instead',
    )
  }
  const channels = addon.captureChannels
  const deviceRate = addon.captureSampleRate
  let lastLevelLogAt = 0

  let handle: ProcessLoopbackHandleState = { addon, native: null }
  handle.native = addon.start(source.processId, source.includeProcessTree ?? true, (frame: Float32Array) => {
    const mono = downmixToMono(frame, channels)
    const atCaptureRate = resampleLinear(mono, deviceRate, CAPTURE_RATE)
    const now = performance.now()
    if (now - lastLevelLogAt > 1000) {
      lastLevelLogAt = now
      let sumSquares = 0
      for (const sample of atCaptureRate) sumSquares += sample * sample
      const rms = Math.sqrt(sumSquares / Math.max(1, atCaptureRate.length))
      logger.debug({ stream: label, rms: Number(rms.toFixed(4)), frames: atCaptureRate.length }, 'loopback capture')
    }
    onAudio({ samples: atCaptureRate, sampleRate: CAPTURE_RATE })
  })
  logger.info({ stream: label, processId: source.processId }, 'process-loopback capture opened')

  return {
    // Idempotent, matching openCaptureStream: the registry has racing stop
    // paths (end_call vs the silence timeout).
    stop(): void {
      if (handle.native === null) return
      handle.addon.stop(handle.native)
      handle = { addon, native: null }
    },
  }
}

interface ProcessLoopbackHandleState {
  addon: ProcessLoopbackAddon
  native: unknown
}

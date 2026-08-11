import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import { cpal, type CpalDevice, type CpalStreamConfig, type CpalStreamHandle } from './cpal.js'
import { downmixToMono, resampleLinear } from './audio-format.js'

// The ONE home for capture: open an input stream on a device and deliver
// 16 kHz mono PCM. The primary mic is one instance; each call's Cable-B feed
// (Part B) is another — N streams by construction, each with its own device,
// config, and consumer. Config comes in pre-resolved (selectDeviceConfig owns
// the wrong-direction fallback) so opening stays a single responsibility.

// Everything downstream (VAD, STT) is fixed at 16 kHz.
export const CAPTURE_RATE = 16_000

export interface CaptureStreamSource {
  device: CpalDevice
  config: CpalStreamConfig
}

export interface CaptureStream {
  stop(): void
}

export function openCaptureStream(
  logger: Logger,
  label: string,
  source: CaptureStreamSource,
  onAudio: (audio: PcmAudio) => void,
): CaptureStream {
  const { device, config } = source
  let lastLevelLogAt = 0 // throttle the diagnostic level log
  let handle: CpalStreamHandle | null = cpal.createStream(
    device.deviceId,
    true,
    config,
    (frame: Float32Array) => {
      const mono = downmixToMono(frame, config.channels)
      const atCaptureRate = resampleLinear(mono, config.sampleRate, CAPTURE_RATE)
      // Diagnostic: prove the stream is alive + carries signal (rms ~0 = silence
      // or wrong channel extraction; rms rises with speech). Throttled.
      const now = performance.now()
      if (now - lastLevelLogAt > 1000) {
        lastLevelLogAt = now
        let sumSquares = 0
        for (const sample of atCaptureRate) sumSquares += sample * sample
        const rms = Math.sqrt(sumSquares / Math.max(1, atCaptureRate.length))
        logger.debug({ stream: label, rms: Number(rms.toFixed(4)), frames: atCaptureRate.length }, 'capture')
      }
      onAudio({ samples: atCaptureRate, sampleRate: CAPTURE_RATE })
    },
  )
  logger.info({ stream: label, device: device.name }, 'capture stream opened')
  return {
    // Idempotent: the call registry will have racing stop paths (`end_call` vs
    // the silence timeout) — a second stop must not re-close the native handle.
    stop(): void {
      if (handle === null) return
      cpal.closeStream(handle)
      handle = null
    },
  }
}

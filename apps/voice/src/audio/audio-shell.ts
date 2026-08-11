import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import type { VoiceSessionIo, VoiceSessionState } from '../loop/voice-session-types.js'
import { cpal } from './cpal.js'
import { selectDeviceConfig, type AudioDeviceSelection } from './device-selection.js'
import { openCaptureStream, type CaptureStream } from './capture-stream.js'
import { monoToChannels, resampleLinear } from './audio-format.js'

// The native audio shell: opens the selected-or-default mic + speaker via
// node-cpal and implements the driver's `VoiceSessionIo`. Capture (downmix +
// resample to 16 kHz) lives in capture-stream.ts — the shell opens the primary
// 'mic' instance of it; TTS PCM is resampled + up-mixed to the speaker's config
// here. LIVE-TUNE (needs a real mic): the drain estimate below.

// The speaker keeps playing after the last frame is written; wait this long past
// the estimated end before reopening the mic so the tail isn't heard by the mic.
const PLAYBACK_TAIL_MS = 350
// Keep the WASAPI output stream WARM. An idle output stream goes cold on Windows
// and the next fresh write produces NO SOUND — which is why the daemon's own
// turn (warm from the active mic conversation) was heard, but a `speak` fired
// while idle/handed-off was silent. Feed a steady trickle of silence between
// real audio so the stream never sleeps.
const KEEPALIVE_MS = 50

export interface AudioShell {
  readonly io: VoiceSessionIo
  /** Open the mic; `onAudio` receives 16 kHz mono PCM as it arrives. */
  start(onAudio: (audio: PcmAudio) => void): void
  stop(): void
}

export function createAudioShell(
  logger: Logger,
  onPlaybackDrained: () => void,
  devices: AudioDeviceSelection = {},
): AudioShell {
  const { device: inputDevice, config: inputConfig } = selectDeviceConfig(
    logger,
    'input',
    devices.input,
    () => cpal.getDefaultInputDevice(),
    (deviceId) => cpal.getDefaultInputConfig(deviceId),
  )
  const { device: outputDevice, config: outputConfig } = selectDeviceConfig(
    logger,
    'output',
    devices.output,
    () => cpal.getDefaultOutputDevice(),
    (deviceId) => cpal.getDefaultOutputConfig(deviceId),
  )
  logger.info(
    { inputDevice: inputDevice.name, input: inputConfig, outputDevice: outputDevice.name, output: outputConfig },
    'audio devices opened',
  )

  // Pass the device's own native config back to createStream — guaranteed valid,
  // no guessing at field names. We convert audio to/from it in the format helpers.
  // Output streams still need a (no-op) callback — the binding requires all args.
  const outputStream = cpal.createStream(outputDevice.deviceId, false, outputConfig, () => {})

  let capture: CaptureStream | null = null
  let playbackStartedAt: number | null = null
  let queuedSeconds = 0
  let drainTimer: ReturnType<typeof setTimeout> | null = null
  let lastRealEmitAt = 0

  // ~KEEPALIVE_MS of silence, in the output's own interleaved format.
  const keepAliveFrame = new Float32Array(
    Math.max(1, Math.round((outputConfig.sampleRate * outputConfig.channels * KEEPALIVE_MS) / 1000)),
  )
  const keepAlive = setInterval(() => {
    // Skip while real audio is actively flowing — it keeps the stream warm on
    // its own, and queuing silence behind it would delay/gap playback.
    if (performance.now() - lastRealEmitAt < 250) return
    cpal.writeToStream(outputStream, keepAliveFrame)
  }, KEEPALIVE_MS)

  const io: VoiceSessionIo = {
    setState(state: VoiceSessionState): void {
      logger.info({ state }, 'voice')
    },
    emitAudio(pcm: PcmAudio): void {
      const atOutputRate = resampleLinear(pcm.samples, pcm.sampleRate, outputConfig.sampleRate)
      const interleaved = monoToChannels(atOutputRate, outputConfig.channels)
      if (playbackStartedAt === null) {
        playbackStartedAt = performance.now()
        queuedSeconds = 0
      }
      queuedSeconds += pcm.samples.length / pcm.sampleRate
      lastRealEmitAt = performance.now()
      cpal.writeToStream(outputStream, interleaved)
    },
    endSpeech(): void {
      const startedAt = playbackStartedAt ?? performance.now()
      const playedSeconds = (performance.now() - startedAt) / 1000
      const remainingMs = Math.max(0, (queuedSeconds - playedSeconds) * 1000) + PLAYBACK_TAIL_MS
      if (drainTimer !== null) clearTimeout(drainTimer)
      drainTimer = setTimeout(() => {
        drainTimer = null
        playbackStartedAt = null
        queuedSeconds = 0
        onPlaybackDrained()
      }, remainingMs)
    },
  }

  return {
    io,
    start(onAudio: (audio: PcmAudio) => void): void {
      capture = openCaptureStream(logger, 'mic', { device: inputDevice, config: inputConfig }, onAudio)
    },
    stop(): void {
      clearInterval(keepAlive)
      if (drainTimer !== null) clearTimeout(drainTimer)
      capture?.stop()
      cpal.closeStream(outputStream)
    },
  }
}

import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import type { VoiceSessionIo, VoiceSessionState } from '../loop/voice-session-types.js'
import { cpal, type CpalStreamHandle } from './cpal.js'
import { downmixToMono, monoToChannels, resampleLinear } from './audio-format.js'

// The native audio shell: opens the default mic + speaker via node-cpal and
// implements the driver's `VoiceSessionIo`. Mic frames are downmixed + resampled
// to 16 kHz mono for the models; TTS PCM is resampled + up-mixed to the speaker's
// config. LIVE-TUNE (needs a real mic): the drain estimate below and, if the mic
// won't open at its default config, the capture path.

const CAPTURE_RATE = 16_000
// The speaker keeps playing after the last frame is written; wait this long past
// the estimated end before reopening the mic so the tail isn't heard by the mic.
const PLAYBACK_TAIL_MS = 350

export interface AudioShell {
  readonly io: VoiceSessionIo
  /** Open the mic; `onAudio` receives 16 kHz mono PCM as it arrives. */
  start(onAudio: (audio: PcmAudio) => void): void
  stop(): void
}

export function createAudioShell(logger: Logger, onPlaybackDrained: () => void): AudioShell {
  const inputDevice = cpal.getDefaultInputDevice()
  const inputConfig = cpal.getDefaultInputConfig(inputDevice.deviceId)
  const outputDevice = cpal.getDefaultOutputDevice()
  const outputConfig = cpal.getDefaultOutputConfig(outputDevice.deviceId)
  logger.info(
    { inputDevice: inputDevice.name, input: inputConfig, outputDevice: outputDevice.name, output: outputConfig },
    'audio devices opened',
  )

  // Pass the device's own native config back to createStream — guaranteed valid,
  // no guessing at field names. We convert audio to/from it in the format helpers.
  const outputStream = cpal.createStream(outputDevice.deviceId, false, outputConfig)

  let inputStream: CpalStreamHandle | null = null
  let playbackStartedAt: number | null = null
  let queuedSeconds = 0
  let drainTimer: ReturnType<typeof setTimeout> | null = null

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
      inputStream = cpal.createStream(
        inputDevice.deviceId,
        true,
        inputConfig,
        (frame: Float32Array) => {
          const mono = downmixToMono(frame, inputConfig.channels)
          const atCaptureRate = resampleLinear(mono, inputConfig.sampleRate, CAPTURE_RATE)
          onAudio({ samples: atCaptureRate, sampleRate: CAPTURE_RATE })
        },
      )
    },
    stop(): void {
      if (drainTimer !== null) clearTimeout(drainTimer)
      if (inputStream !== null) cpal.closeStream(inputStream)
      cpal.closeStream(outputStream)
    },
  }
}

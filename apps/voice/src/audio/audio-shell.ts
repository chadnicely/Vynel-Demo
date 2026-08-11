import type { Logger } from 'pino'
import type { PcmAudio } from '@vynel/voice-engine'
import type { VoiceSessionIo, VoiceSessionState } from '../loop/voice-session-types.js'
import { cpal } from './cpal.js'
import { selectDeviceConfig, type AudioDeviceSelection } from './device-selection.js'
import { openCaptureStream, type CaptureStream } from './capture-stream.js'
import { openOutputSink } from './output-sink.js'

// The native audio shell: composes the daemon's PRIMARY audio pair — the
// selected-or-default mic as one capture-stream instance, the selected-or-
// default speaker as one output-sink instance — and implements the driver's
// `VoiceSessionIo`. Conversion, keepalive and the drain estimate live in the
// two stream homes; call feeds (Part B) open their own instances of the same.

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
  const input = selectDeviceConfig(
    logger,
    'input',
    devices.input,
    () => cpal.getDefaultInputDevice(),
    (deviceId) => cpal.getDefaultInputConfig(deviceId),
  )
  const output = selectDeviceConfig(
    logger,
    'output',
    devices.output,
    () => cpal.getDefaultOutputDevice(),
    (deviceId) => cpal.getDefaultOutputConfig(deviceId),
  )
  logger.info(
    {
      inputDevice: input.device.name,
      input: input.config,
      outputDevice: output.device.name,
      output: output.config,
    },
    'audio devices opened',
  )

  const sink = openOutputSink(logger, 'speaker', output, onPlaybackDrained)
  let capture: CaptureStream | null = null

  const io: VoiceSessionIo = {
    setState(state: VoiceSessionState): void {
      logger.info({ state }, 'voice')
    },
    emitAudio: (pcm: PcmAudio): void => sink.emitAudio(pcm),
    endSpeech: (): void => sink.endSpeech(),
    cutPlayback: (): void => sink.cutPlayback(),
  }

  return {
    io,
    start(onAudio: (audio: PcmAudio) => void): void {
      // One primary mic per shell — a duplicate start would leak the first
      // stream's handle and double-deliver every frame.
      if (capture !== null) {
        logger.warn('audio shell already started — ignoring duplicate start')
        return
      }
      capture = openCaptureStream(logger, 'mic', input, onAudio)
    },
    stop(): void {
      capture?.stop()
      sink.stop()
    },
  }
}

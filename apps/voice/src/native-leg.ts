import type { Logger } from 'pino'
import { SherpaVoiceActivityDetector } from '@vynel/voice-engine'
import type {
  PcmAudio,
  SpeechRecognizer,
  VoiceActivityDetector,
  VoiceEngine,
} from '@vynel/voice-engine'
import { createAudioShell, type AudioShell } from './audio/audio-shell.js'
import { cpal } from './audio/cpal.js'
import { resolveAudioDevices } from './audio/device-selection.js'
import { createBrainClient } from './brain/run-brain-turn.js'
import { VoiceSessionDriver } from './loop/voice-session-driver.js'
import type { VoiceSessionIo, WakeHandoff } from './loop/voice-session-types.js'
import type { OverlayChannel } from './overlay/overlay-channel.js'
import type { Env } from './env.js'
import type { VoiceEngineSlot } from './voice-engine-slot.js'

// The NATIVE leg: the daemon's own microphone and speaker — the open mic that
// hears "Hey Vynel", the VAD that cuts it into utterances, the driver that runs
// the native conversation. It needs two things an installed app may not have
// yet: the voice models (the slot) and a working default audio device. Either
// missing → no native leg, and the daemon still serves the overlay channel
// (the in-app Display leg, the dock, `/reload`); a later `/reload` starts it
// once the models land.

export interface NativeLeg {
  readonly driver: VoiceSessionDriver
  stop(): void
}

export interface NativeLegDeps {
  readonly env: Env
  readonly logger: Logger
  readonly slot: VoiceEngineSlot
  readonly overlay: OverlayChannel
  readonly recognizer: SpeechRecognizer
  /** The in-session lane (a cloud provider, when picked) — the driver uses it
   *  for commands only; wake stays on `recognizer`. */
  readonly transcribeCommand?: (audio: PcmAudio) => Promise<string>
  readonly synthesizer: VoiceEngine
  readonly wakeHandoff: WakeHandoff
}

/** Start the native leg, or answer null when this machine cannot carry it
 *  (no default audio device) — logged once, never fatal. Call only with a
 *  ready slot: the VAD model is one of the voice models. */
export function startNativeLeg(deps: NativeLegDeps): NativeLeg | null {
  const { env, logger, slot, overlay } = deps
  let audioShell: AudioShell
  // audioShell + driver need each other — the shell gets a late-bound driver.
  let driver: VoiceSessionDriver | null = null
  try {
    const audioDevices = resolveAudioDevices(
      logger,
      { inputName: env.VYNEL_VOICE_INPUT_DEVICE, outputName: env.VYNEL_VOICE_OUTPUT_DEVICE },
      () => cpal.getDevices(),
    )
    audioShell = createAudioShell(logger, () => driver?.notifyPlaybackDrained(), audioDevices)
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'no usable audio device — the native microphone leg is off; the in-app voice still works',
    )
    return null
  }

  const vad = new SherpaVoiceActivityDetector({ vad: slot.engines.vadConfig })
  // Mirror every state change to the browser voice view alongside the log line.
  const io: VoiceSessionIo = {
    setState: (state) => {
      audioShell.io.setState(state)
      overlay.publishState(state)
    },
    emitAudio: (audio) => audioShell.io.emitAudio(audio),
    endSpeech: () => audioShell.io.endSpeech(),
    cutPlayback: () => audioShell.io.cutPlayback(),
  }
  const sessionDriver = new VoiceSessionDriver(
    {
      logger,
      vad: traceVad(vad, logger),
      recognizer: traceRecognizer(deps.recognizer, logger),
      ...(deps.transcribeCommand !== undefined
        ? { transcribeCommand: deps.transcribeCommand }
        : {}),
      synthesizer: deps.synthesizer,
      brain: createBrainClient(env.VYNEL_API_URL),
      io,
      onSpeakError: (error, text) =>
        logger.error(
          { error: error instanceof Error ? error.message : String(error), text: text.slice(0, 80) },
          'speak failed — nothing was heard for this line',
        ),
      onTurnWatchdog: (utterance) =>
        logger.warn(
          { utterance: utterance.slice(0, 80), watchdogMs: env.VYNEL_VOICE_TURN_WATCHDOG_MS },
          'turn watchdog fired — the room is back; the turn streams on and its answer is spoken when it lands',
        ),
      // The browser owns the command session (Web Speech STT + spoken reply
      // run there). What a wake does to the screen lives in `wake-handoff.ts`;
      // without the dock feature it is simply "hand off to a connected client
      // that declared it can RUN a session" — the desktop shell's windows never
      // do (its main window is connected for state events + the mic button, and
      // must not swallow the wake), a browser tab does only with Web Speech;
      // with no capable client the native leg answers.
      wakeHandoff: deps.wakeHandoff,
    },
    {
      idleTimeoutMs: env.VYNEL_VOICE_IDLE_TIMEOUT_MS,
      turnWatchdogMs: env.VYNEL_VOICE_TURN_WATCHDOG_MS,
      // No voiceId here: the shared synthesize lane applies the user's pick.
    },
  )

  driver = sessionDriver
  // A device that enumerates but will not open (in use exclusively, a driver
  // glitch) must not take the daemon down either — same verdict as no device.
  try {
    audioShell.start((audio) => {
      void sessionDriver.pushAudio(audio)
    })
  } catch (error) {
    audioShell.stop()
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'the microphone could not be opened — the native microphone leg is off; the in-app voice still works',
    )
    return null
  }
  logger.info('native microphone leg listening — say "Hey Vynel"')

  return {
    driver: sessionDriver,
    stop: () => {
      audioShell.stop()
      sessionDriver.stop()
    },
  }
}

// Diagnostic wrappers (LOG_LEVEL=debug): surface VAD segments + every transcript
// so a silent loop can be traced to the exact stage it stalls.
function traceVad(vad: VoiceActivityDetector, logger: Logger): VoiceActivityDetector {
  return {
    push(audio) {
      const segments = vad.push(audio)
      for (const segment of segments) {
        logger.debug({ seconds: Number((segment.samples.length / segment.sampleRate).toFixed(2)) }, 'vad segment')
      }
      return segments
    },
    flush: () => vad.flush(),
  }
}

function traceRecognizer(recognizer: SpeechRecognizer, logger: Logger): SpeechRecognizer {
  return {
    async transcribe(audio) {
      const text = await recognizer.transcribe(audio)
      logger.debug({ transcript: text }, 'stt')
      return text
    },
  }
}

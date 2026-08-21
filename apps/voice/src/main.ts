// The Vynel voice daemon — an always-on background sidecar. It listens on the
// mic, wakes on "Hey Vynel", runs a multi-turn conversation against the brain
// (local-api `/root/turn`), speaks the answers, and falls back asleep on silence.
// Everything on the CPU, no Python. Run with local-api up: `pnpm --filter
// @vynel/voice-daemon dev`.

import pino from 'pino'
import { SherpaVoiceActivityDetector } from '@vynel/voice-engine'
import type {
  PcmAudio,
  SpeechRecognizer,
  SynthesizeOptions,
  VoiceActivityDetector,
  VoiceEngine,
} from '@vynel/voice-engine'
import type { Logger } from 'pino'
import { loadEnv } from './env.js'
import { VoiceEngines, VoiceModelMissingError } from './voice-engines.js'
import { readVoiceSelection } from './voice-selection.js'
import { createBrainClient } from './brain/run-brain-turn.js'
import { createAudioShell } from './audio/audio-shell.js'
import { cpal } from './audio/cpal.js'
import { resolveAudioDevices } from './audio/device-selection.js'
import { encodeWav } from './audio/wav-encode.js'
import { CallRegistry } from './call/call-registry.js'
import {
  createLinuxCallCablePool,
  reapStaleVynelModules,
  type LinuxCallCablePool,
} from './call/linux-null-sink-cables.js'
import { createCallEndpoints } from './call/call-endpoints.js'
import { createCallConversationHost } from './call/call-conversation-host.js'
import { createCallSessionClient } from './call/call-session-client.js'
import { serializeAsync } from './call/serialize-async.js'
import { startOverlayChannel } from './overlay/overlay-channel.js'
import { createDisplayDockWindow } from './overlay/display-dock-window.js'
import { createWakeHandoff } from './overlay/wake-handoff.js'
import { VoiceSessionDriver } from './loop/voice-session-driver.js'
import type { VoiceSessionIo } from './loop/voice-session-types.js'

// If a launched display dock never connects (Chrome missing, web app down),
// give up the handoff and resume wake-listening — a failed launch must not
// leave the daemon deaf.
const DOCK_CONNECT_TIMEOUT_MS = 10_000

async function main(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  // The user's voice pick (Settings → Voice) — env is the fallback for a daemon
  // that boots before the engine, or a dev box with no pick saved.
  const envSelection = {
    ttsModelId: env.VYNEL_VOICE_TTS,
    sttModelId: env.VYNEL_VOICE_STT,
    speakerId: env.VYNEL_VOICE_ID,
  }
  const readSelection = () =>
    readVoiceSelection({ apiUrl: env.VYNEL_API_URL, fallback: envSelection })
  const selection = await readSelection()

  // A pick whose files are gone (removed by hand, a fresh models dir) must not
  // keep the daemon from starting: fall back to the env models, say which
  // pick is missing, and let the reload bring the pick back once it is
  // downloaded.
  const loadEngines = (candidate: typeof selection): VoiceEngines => {
    logger.info({ tts: candidate.ttsModelId, stt: candidate.sttModelId }, 'loading voice models on CPU…')
    return VoiceEngines.load(env.VYNEL_VOICE_MODELS_DIR, candidate, logger)
  }
  let engines: VoiceEngines
  try {
    engines = loadEngines(selection)
  } catch (error) {
    if (!(error instanceof VoiceModelMissingError)) throw error
    logger.warn({ missing: error.missingPath }, 'the picked voice model is not on the disk — falling back to the env models')
    try {
      engines = loadEngines({ ...envSelection, speakerId: selection.speakerId })
    } catch (fallbackError) {
      if (!(fallbackError instanceof VoiceModelMissingError)) throw fallbackError
      logger.error(
        { missing: fallbackError.missingPath },
        'voice model file missing — download it in Settings → Voice, or run `pnpm voice:fetch-models <model>` for each of kokoro, moonshine-base, silero-vad',
      )
      process.exitCode = 1
      return
    }
  }
  const vadConfig = engines.vadConfig
  const vad = new SherpaVoiceActivityDetector({ vad: vadConfig })
  logger.info(
    { voices: engines.synthesizer.voiceCount, sampleRate: engines.synthesizer.sampleRate },
    'models loaded',
  )

  // The native STT/TTS engines are SINGLE instances shared by the wake line
  // and every call loop — serialize them so concurrent turns can't race the
  // sherpa addon (each call gets its own VAD; those are per-stream state).
  // Both lanes read the HOLDER at call time, so a reload's swap lands between
  // calls. The speaker is injected HERE — the one place the pick is applied —
  // unless a caller chose one deliberately.
  const sharedTranscribe = serializeAsync((audio: PcmAudio) => engines.recognizer.transcribe(audio))
  const sharedSynthesize = serializeAsync((text: string, options?: SynthesizeOptions) =>
    engines.synthesizer.synthesize(text, { voiceId: engines.selection.speakerId, ...options }),
  )
  const serializedRecognizer: SpeechRecognizer = { transcribe: sharedTranscribe }
  const serializedSynthesizer: VoiceEngine = { synthesize: sharedSynthesize }

  // audioShell + overlay need driver callbacks, and the driver needs both of
  // them — so build them first with a late-bound driver reference.
  let driver!: VoiceSessionDriver
  const audioDevices = resolveAudioDevices(
    logger,
    { inputName: env.VYNEL_VOICE_INPUT_DEVICE, outputName: env.VYNEL_VOICE_OUTPUT_DEVICE },
    () => cpal.getDevices(),
  )
  const audioShell = createAudioShell(logger, () => driver.notifyPlaybackDrained(), audioDevices)
  // The env cable-pair inventory — env's superRefine guarantees each pair is
  // whole, so presence of one end means the pair exists.
  const envCallCablePairs = [
    ...(env.VYNEL_CALL_INPUT_DEVICE !== undefined && env.VYNEL_CALL_OUTPUT_DEVICE !== undefined
      ? [{ inputName: env.VYNEL_CALL_INPUT_DEVICE, outputName: env.VYNEL_CALL_OUTPUT_DEVICE }]
      : []),
    ...(env.VYNEL_CALL_INPUT_DEVICE_2 !== undefined && env.VYNEL_CALL_OUTPUT_DEVICE_2 !== undefined
      ? [{ inputName: env.VYNEL_CALL_INPUT_DEVICE_2, outputName: env.VYNEL_CALL_OUTPUT_DEVICE_2 }]
      : []),
  ]
  // Linux needs no cable install at all: the daemon provisions null-sink
  // pairs at boot and reaps strays from a crashed run first
  // (docs/module-notes/virtual-audio-driver.md). Env pairs stay the Windows
  // path (on Linux they remain claimable behind the pool; VYNEL_CALL_LINUX_PAIRS=0
  // makes them the only inventory).
  let linuxCablePool: LinuxCallCablePool | null = null
  if (process.platform === 'linux' && env.VYNEL_CALL_LINUX_PAIRS > 0) {
    await reapStaleVynelModules(logger)
    linuxCablePool = await createLinuxCallCablePool(logger, env.VYNEL_CALL_LINUX_PAIRS)
  }
  const callRegistry = new CallRegistry(logger, [
    ...(linuxCablePool?.pairs ?? []),
    ...envCallCablePairs,
  ])
  const callConversations = createCallConversationHost({
    logger,
    // The spoken address name, matching the wake phrase's persona. The persona
    // rename arc will thread a configurable name through here later.
    assistantName: 'Vynel',
    sessionClient: createCallSessionClient(env.VYNEL_API_URL),
    turnWatchdogMs: env.VYNEL_VOICE_TURN_WATCHDOG_MS,
    createVad: () => new SherpaVoiceActivityDetector({ vad: vadConfig }),
    transcribe: sharedTranscribe,
    synthesize: (sentence) => sharedSynthesize(sentence),
    findCallSink: (callId) => callRegistry.findCallSink(callId),
  })
  callRegistry.bindCallLoop(callConversations)
  const dockEnabled = env.VYNEL_VOICE_DOCK_WINDOW === '1'
  const overlay = startOverlayChannel(
    env.VYNEL_VOICE_DAEMON_PORT,
    {
      onSessionEnd: () => driver.endHandoff(),
      onClientsGone: () => driver.endHandoff(),
      // The overlay speaks with the daemon's own voice — one voice everywhere.
      onSynthesize: async (text) => encodeWav(await sharedSynthesize(text)),
      // Settings → Voice saved: re-read the pick and swap what changed.
      onReload: async () => engines.apply(await readSelection()),
      // The `speak` MCP tool — any session's voice output. Route it to whoever
      // can actually play it:
      //   - while an overlay owns the command session (handed-off) it is
      //     PUBLISHED to that owner — speaking natively would put the browser
      //     speaker and the daemon speaker on one machine. The event carries
      //     the PRODUCING session id, so the client plays a schedule's or the
      //     Voice-chat panel's line and drops only its own turn's (which it
      //     already voices off its own stream);
      //   - otherwise a connected-but-idle client is ASKED to play it (typed
      //     chat, scheduled tasks — the browser owns reliable playback while
      //     an overlay window holds the audio device);
      //   - no client at all → the daemon's native speaker queue.
      // Accept + hand off → resolves immediately.
      onSpeak: (text, sessionId) => {
        const preview = text.slice(0, 80)
        if (driver.isHandedOff) {
          if (overlay.publishSpeak(text, sessionId)) {
            logger.info({ text: preview, sessionId }, 'speak — handed to the overlay that owns the session')
          } else {
            logger.info({ text: preview }, 'speak — overlay client gone mid-handoff, speaking natively')
            driver.speak(text)
          }
        } else if (!driver.isAwake && overlay.publishSpeak(text, sessionId)) {
          // Delegate only while the native loop is IDLE: a client playing audio
          // mid native conversation would be heard by the open daemon mic (the
          // echo defense only guards the daemon's own speaker path).
          logger.info({ text: preview, sessionId }, 'speak — delivered to a connected overlay client')
        } else {
          logger.info({ text: preview }, 'speak requested (native)')
          driver.speak(text)
        }
        return Promise.resolve()
      },
    },
    logger,
    // With the dock window on, ONLY it runs wake sessions — app tabs keep
    // their state events + manual mic sessions but never race it for a wake.
    // With it OFF the dock surface is never a target either: the desktop
    // shell keeps its hidden dock webview connected whatever the flag says,
    // and a wake handed to it would vanish into a window nobody sees — so
    // 0 = native unless a wake-capable BROWSER tab is connected (an 'app'
    // subscriber that declared it can run a session). The watchdog rides
    // every wake so the browser leg is bounded by the same knob as the native
    // leg (one home: env).
    {
      wakeSurface: dockEnabled ? 'dock' : 'app',
      turnWatchdogMs: env.VYNEL_VOICE_TURN_WATCHDOG_MS,
      routes: [{ path: '/calls', app: createCallEndpoints(callRegistry, callConversations, logger) }],
    },
  )
  overlay.whenListening.catch((error: unknown) => {
    logger.error(
      { port: env.VYNEL_VOICE_DAEMON_PORT, error: error instanceof Error ? error.message : String(error) },
      'overlay channel failed to start — is another voice daemon already running? ' +
        'Stop it, or set VYNEL_VOICE_DAEMON_PORT to a free port.',
    )
    audioShell.stop()
    driver.stop()
    // eslint-disable-next-line n/no-process-exit -- fail fast: without the channel the display dock can never connect
    process.exit(1)
  })
  const dockWindow = createDisplayDockWindow(
    {
      browser: env.VYNEL_VOICE_DOCK_BROWSER,
      url: env.VYNEL_VOICE_DOCK_URL,
      appPath: env.VYNEL_VOICE_DOCK_APP,
    },
    logger,
  )
  const wakeHandoff = createWakeHandoff({
    overlay,
    dockWindow,
    dockEnabled,
    logger,
    connectTimeoutMs: DOCK_CONNECT_TIMEOUT_MS,
    abandonHandoff: () => driver.endHandoff(),
  })
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
  driver = new VoiceSessionDriver(
    {
      logger,
      vad: traceVad(vad, logger),
      recognizer: traceRecognizer(serializedRecognizer, logger),
      synthesizer: serializedSynthesizer,
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
      wakeHandoff: wakeHandoff.handoff,
    },
    {
      idleTimeoutMs: env.VYNEL_VOICE_IDLE_TIMEOUT_MS,
      turnWatchdogMs: env.VYNEL_VOICE_TURN_WATCHDOG_MS,
      // No voiceId here: the shared synthesize lane applies the user's pick.
    },
  )

  audioShell.start((audio) => {
    void driver.pushAudio(audio)
  })
  logger.info({ apiUrl: env.VYNEL_API_URL }, 'voice daemon listening — say "Hey Vynel"')

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'voice daemon shutting down')
    wakeHandoff.stop()
    callRegistry.stopAll()
    audioShell.stop()
    overlay.stop()
    driver.stop()
    const exitNow = (): void => {
      // eslint-disable-next-line n/no-process-exit -- explicit exit at the end of a graceful shutdown
      process.exit(0)
    }
    if (linuxCablePool === null) {
      exitNow()
      return
    }
    // Unloading pulse modules is I/O — bound it so a hung sound server can
    // never wedge the daemon's exit.
    void Promise.race([
      linuxCablePool.destroy(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]).finally(exitNow)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
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

main().catch((error: unknown) => {
  // The daemon may die before (or after) its configured logger exists — a
  // bare pino still gets a structured fatal line out.
  pino().fatal(
    { error: error instanceof Error ? error.message : String(error) },
    'voice daemon failed to boot',
  )
  // eslint-disable-next-line n/no-process-exit -- a half-booted daemon must not linger holding the audio device and the port
  process.exit(1)
})

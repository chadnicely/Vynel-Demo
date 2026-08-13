// The Vynel voice daemon — an always-on background sidecar. It listens on the
// mic, wakes on "Hey Vynel", runs a multi-turn conversation against the brain
// (local-api `/root/turn`), speaks the answers, and falls back asleep on silence.
// Everything on the CPU, no Python. Run with local-api up: `pnpm --filter
// @vynel/voice-daemon dev`.

import pino from 'pino'
import { SherpaSpeechRecognizer, SherpaVoiceActivityDetector, SherpaVoiceEngine } from '@vynel/voice-engine'
import type {
  PcmAudio,
  SpeechRecognizer,
  SynthesizeOptions,
  VoiceActivityDetector,
  VoiceEngine,
} from '@vynel/voice-engine'
import type { Logger } from 'pino'
import { loadEnv } from './env.js'
import {
  findMissingModelFile,
  resolveSttConfig,
  resolveTtsConfig,
  resolveVadConfig,
} from './models.js'
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
import { createJarvisWindow } from './overlay/jarvis-window.js'
import { VoiceSessionDriver } from './loop/voice-session-driver.js'
import type { VoiceSessionIo } from './loop/voice-session-types.js'

// If a launched Jarvis window never connects (Chrome missing, web app down),
// give up the handoff and resume wake-listening — a failed launch must not
// leave the daemon deaf.
const JARVIS_CONNECT_TIMEOUT_MS = 10_000

async function main(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  const ttsConfig = resolveTtsConfig(env.VYNEL_VOICE_MODELS_DIR, env.VYNEL_VOICE_TTS)
  const sttConfig = resolveSttConfig(env.VYNEL_VOICE_MODELS_DIR, env.VYNEL_VOICE_STT)
  const vadConfig = resolveVadConfig(env.VYNEL_VOICE_MODELS_DIR)

  const missing = findMissingModelFile(ttsConfig, sttConfig, vadConfig)
  if (missing !== null) {
    logger.error(
      { missing },
      'voice model file missing — run `pnpm voice:fetch-models kokoro` (+ moonshine + silero-vad)',
    )
    process.exitCode = 1
    return
  }

  logger.info({ tts: env.VYNEL_VOICE_TTS, stt: env.VYNEL_VOICE_STT }, 'loading voice models on CPU…')
  const synthesizer = new SherpaVoiceEngine({ tts: ttsConfig })
  const recognizer = new SherpaSpeechRecognizer({ stt: sttConfig })
  const vad = new SherpaVoiceActivityDetector({ vad: vadConfig })
  logger.info({ voices: synthesizer.voiceCount, sampleRate: synthesizer.sampleRate }, 'models loaded')

  // The native STT/TTS engines are SINGLE instances shared by the wake line
  // and every call loop — serialize them so concurrent turns can't race the
  // sherpa addon (each call gets its own VAD; those are per-stream state).
  const sharedTranscribe = serializeAsync((audio: PcmAudio) => recognizer.transcribe(audio))
  const sharedSynthesize = serializeAsync((text: string, options?: SynthesizeOptions) =>
    synthesizer.synthesize(text, options),
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
    createVad: () => new SherpaVoiceActivityDetector({ vad: vadConfig }),
    transcribe: sharedTranscribe,
    synthesize: (sentence) => sharedSynthesize(sentence, { voiceId: env.VYNEL_VOICE_ID }),
    findCallSink: (callId) => callRegistry.findCallSink(callId),
  })
  callRegistry.bindCallLoop(callConversations)
  const jarvisEnabled = env.VYNEL_VOICE_JARVIS_WINDOW === '1'
  const overlay = startOverlayChannel(
    env.VYNEL_VOICE_DAEMON_PORT,
    {
      onSessionEnd: () => driver.endHandoff(),
      onClientsGone: () => driver.endHandoff(),
      // The overlay speaks with the daemon's own voice — one voice everywhere.
      onSynthesize: async (text) =>
        encodeWav(await sharedSynthesize(text, { voiceId: env.VYNEL_VOICE_ID })),
      // The `speak` MCP tool — any global session's voice output. Route it to
      // whoever can actually play it:
      //   - a LIVE overlay command session (handed-off) plays its own turn's
      //     speak calls from its stream — re-routing would double-play;
      //   - otherwise a connected-but-idle client is ASKED to play it (typed
      //     chat, scheduled tasks — the browser owns reliable playback while
      //     an overlay window holds the audio device);
      //   - no client at all → the daemon's native speaker queue.
      // Accept + hand off → resolves immediately.
      onSpeak: (text) => {
        if (driver.isHandedOff) {
          logger.info({ text: text.slice(0, 80) }, 'speak — the live overlay session plays it')
        } else if (!driver.isAwake && overlay.publishSpeak(text)) {
          // Delegate only while the native loop is IDLE: a client playing audio
          // mid native conversation would be heard by the open daemon mic (the
          // echo defense only guards the daemon's own speaker path).
          logger.info({ text: text.slice(0, 80) }, 'speak — delivered to a connected overlay client')
        } else {
          logger.info({ text: text.slice(0, 80) }, 'speak requested (native)')
          driver.speak(text)
        }
        return Promise.resolve()
      },
    },
    logger,
    // With the floating window on, ONLY it runs wake sessions — app tabs keep
    // their state events + manual mic sessions but never race it for a wake.
    {
      wakeSurface: jarvisEnabled ? 'jarvis' : 'any',
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
    // eslint-disable-next-line n/no-process-exit -- fail fast: without the channel the Jarvis window can never connect
    process.exit(1)
  })
  const jarvisWindow = createJarvisWindow(
    {
      browser: env.VYNEL_VOICE_JARVIS_BROWSER,
      url: env.VYNEL_VOICE_JARVIS_URL,
      appPath: env.VYNEL_VOICE_JARVIS_APP,
    },
    logger,
  )
  let jarvisConnectWatchdog: ReturnType<typeof setTimeout> | null = null
  // Mirror every state change to the browser Jarvis view alongside the log line.
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
      vad: traceVad(vad, logger),
      recognizer: traceRecognizer(serializedRecognizer, logger),
      synthesizer: serializedSynthesizer,
      runBrainTurn: createBrainClient(env.VYNEL_API_URL),
      io,
      onSpeakError: (error, text) =>
        logger.error(
          { error: error instanceof Error ? error.message : String(error), text: text.slice(0, 80) },
          'speak failed — nothing was heard for this line',
        ),
      // The browser owns the command session (Web Speech STT + spoken reply
      // run there). Jarvis mode: every wake hands off — the floating window is
      // opened/focused, and the held wake replays once it connects. Otherwise:
      // hand off only to an already-connected tab, else answer natively.
      wakeHandoff: {
        shouldHandOff: () => jarvisEnabled || overlay.hasClient,
        publishWake: (command) => {
          overlay.publishWake(command)
          if (!jarvisEnabled) return
          if (overlay.hasWakeTarget) {
            jarvisWindow.focus()
            return
          }
          jarvisWindow.open()
          if (jarvisConnectWatchdog !== null) clearTimeout(jarvisConnectWatchdog)
          jarvisConnectWatchdog = setTimeout(() => {
            jarvisConnectWatchdog = null
            if (!overlay.hasWakeTarget) {
              logger.warn('jarvis window never connected — resuming wake listening')
              driver.endHandoff()
            }
          }, JARVIS_CONNECT_TIMEOUT_MS)
        },
      },
    },
    { idleTimeoutMs: env.VYNEL_VOICE_IDLE_TIMEOUT_MS, voiceId: env.VYNEL_VOICE_ID },
  )

  audioShell.start((audio) => {
    void driver.pushAudio(audio)
  })
  logger.info({ apiUrl: env.VYNEL_API_URL }, 'voice daemon listening — say "Hey Vynel"')

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'voice daemon shutting down')
    if (jarvisConnectWatchdog !== null) clearTimeout(jarvisConnectWatchdog)
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

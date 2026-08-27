// The Vynel voice daemon — an always-on background sidecar. It listens on the
// mic, wakes on "Hey Vynel", runs a multi-turn conversation against the brain
// (local-api `/root/turn`), speaks the answers, and falls back asleep on silence.
// Everything on the CPU, no Python. Run with local-api up: `pnpm --filter
// @vynel/voice-daemon dev`; the installed app spawns it beside the engine.
//
// It boots with or without a voice (Kafi, 2026-08-22): an installed app has no
// voice models until Settings → Voice downloads them, so the overlay channel
// always comes up, synthesis says "no voice yet" until then, and the first
// `/reload` after a download fills the engines and starts the microphone leg
// — no restart.

import pino from 'pino'
import { SherpaVoiceActivityDetector } from '@vynel/voice-engine'
import type { PcmAudio, SpeechRecognizer, SynthesizeOptions, VoiceEngine } from '@vynel/voice-engine'
import { loadEnv } from './env.js'
import { VoiceEngineSlot } from './voice-engine-slot.js'
import {
  fetchVoiceSelection,
  readVoiceSelection,
  settleVoiceSelectionWithEngine,
} from './voice-selection.js'
import { encodeWavFromPcm } from '@vynel/voice-engine/pcm-codec'
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
import { startNativeLeg, type NativeLeg } from './native-leg.js'

// If a launched display dock never connects (Chrome missing, web app down),
// give up the handoff and resume wake-listening — a failed launch must not
// leave the daemon deaf.
const DOCK_CONNECT_TIMEOUT_MS = 10_000

async function main(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  // The user's voice pick (Settings → Voice) — env is the fallback for a daemon
  // that boots before the engine, or a dev box with no pick saved (sources
  // default to the pre-provider behavior: local voice, web-speech commands).
  const envSelection = {
    ttsSource: 'local' as const,
    sttSource: 'web-speech' as const,
    ttsModelId: env.VYNEL_VOICE_TTS,
    sttModelId: env.VYNEL_VOICE_STT,
    speakerId: env.VYNEL_VOICE_ID,
  }
  const readSelection = () =>
    readVoiceSelection({ apiUrl: env.VYNEL_API_URL, fallback: envSelection })
  // The strict boot read: null = the engine is not up yet (an app start races
  // both processes), and the env fallback is a STAND-IN, not the user's pick.
  const bootRead = await fetchVoiceSelection({ apiUrl: env.VYNEL_API_URL, fallback: envSelection })
  const selection = bootRead ?? envSelection

  // The pick first; a pick whose files are gone falls back to the env models
  // (the slot owns that order, at boot and on every reload); nothing on the
  // disk at all = no voice yet, and the daemon still comes up.
  const slot = new VoiceEngineSlot(logger, {
    modelsDir: env.VYNEL_VOICE_MODELS_DIR,
    fallback: envSelection,
    relay: { apiUrl: env.VYNEL_API_URL },
  })
  if (!slot.tryLoad(selection)) {
    logger.warn('no voice model installed yet — download one in Settings → Voice (the daemon waits)')
  }

  // The native STT engine is a SINGLE instance shared by the wake line and
  // every call loop — serialize it so concurrent turns can't race the sherpa
  // addon (each call gets its own VAD; those are per-stream state). Synthesis
  // needs no mutex HERE: `VoiceEngines` serializes its native half internally
  // (the sherpa lane), and a provider relay is plain HTTP that may run
  // concurrently. Both lanes read the SLOT at call time, so a reload's swap
  // (or its first fill) lands between calls. The speaker is injected HERE —
  // the one place the pick is applied — unless a caller chose one deliberately.
  const sharedTranscribe = serializeAsync((audio: PcmAudio) => slot.engines.recognizer.transcribe(audio))
  const sharedSynthesize = (text: string, options?: SynthesizeOptions) =>
    slot.engines.synthesizer.synthesize(text, { voiceId: slot.engines.selection.speakerId, ...options })
  const serializedRecognizer: SpeechRecognizer = { transcribe: sharedTranscribe }
  const sharedSynthesizer: VoiceEngine = { synthesize: sharedSynthesize }
  // IN-SESSION transcription (commands, call legs). When the session lane IS
  // the local recognizer it must ride the same serialized lane (one native
  // instance); the engine relay is plain HTTP and needs no mutex.
  const sharedSessionTranscribe = (audio: PcmAudio): Promise<string> => {
    const engines = slot.engines
    return engines.sessionRecognizer === engines.recognizer
      ? sharedTranscribe(audio)
      : engines.sessionRecognizer.transcribe(audio)
  }

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
    createVad: () => new SherpaVoiceActivityDetector({ vad: slot.engines.vadConfig }),
    // A call leg is in-session by definition — the cloud lane when picked.
    transcribe: sharedSessionTranscribe,
    synthesize: (sentence) => sharedSynthesize(sentence),
    findCallSink: (callId) => callRegistry.findCallSink(callId),
  })
  callRegistry.bindCallLoop(callConversations)

  // The microphone leg — started once there is a voice AND a device; null
  // until then (the overlay hooks below answer for both cases).
  let nativeLeg: NativeLeg | null = null
  const dockEnabled = env.VYNEL_VOICE_DOCK_WINDOW === '1'
  const overlay = startOverlayChannel(
    env.VYNEL_VOICE_DAEMON_PORT,
    {
      // A web surface took the microphone (wake or not) — the native STT must
      // not transcribe the same room underneath it.
      onSessionStart: () => nativeLeg?.driver.beginHandoff(),
      onSessionEnd: () => nativeLeg?.driver.endHandoff(),
      onClientsGone: () => nativeLeg?.driver.endHandoff(),
      // The overlay speaks with the daemon's own voice — one voice everywhere.
      onSynthesize: async (text) => encodeWavFromPcm(await sharedSynthesize(text)),
      // Settings → Voice saved (or a download landed): re-read the pick, fill
      // or swap the engines, and start the microphone leg if it is not up.
      onReload: async () => {
        const outcome = slot.apply(await readSelection())
        if (outcome.ready && nativeLeg === null) nativeLeg = startMicrophoneLeg()
        return outcome
      },
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
      //   - no client at all → the daemon's native speaker queue — or, with no
      //     microphone leg, nowhere: logged, never thrown.
      // Accept + hand off → resolves immediately.
      onSpeak: (text, sessionId) => {
        // Whoever ends up playing the line, the dock should be on screen for
        // it — a proactive spoken line with no pixels anywhere is a voice from
        // nowhere. Broadcast, because the audio below is single-delivery and
        // may land in a window that is not the dock; the text rides along so
        // the dock has a caption even when another window plays the audio.
        overlay.publishShowDock(text)
        const preview = text.slice(0, 80)
        const driver = nativeLeg?.driver ?? null
        if (driver?.isHandedOff) {
          if (overlay.publishSpeak(text, sessionId)) {
            logger.info({ text: preview, sessionId }, 'speak — handed to the overlay that owns the session')
          } else {
            logger.info({ text: preview }, 'speak — overlay client gone mid-handoff, speaking natively')
            driver.speak(text)
          }
        } else if ((driver === null || !driver.isAwake) && overlay.publishSpeak(text, sessionId)) {
          // Delegate only while the native loop is IDLE: a client playing audio
          // mid native conversation would be heard by the open daemon mic (the
          // echo defense only guards the daemon's own speaker path).
          logger.info({ text: preview, sessionId }, 'speak — delivered to a connected overlay client')
        } else if (driver !== null) {
          logger.info({ text: preview }, 'speak requested (native)')
          driver.speak(text)
        } else {
          logger.warn({ text: preview }, 'speak — no voice and no connected client; nothing was heard')
        }
        return Promise.resolve()
      },
      // A browser client the line was delegated to could not START it —
      // autoplay policy, zero audio out. Fall back to the native speaker: the
      // same thing onSpeak would have done with no client at all. Sentence-
      // sized POSTs arrive in playback order, and the speech lane keeps them
      // in order on this side too.
      onSpeakRefused: (text) => {
        const driver = nativeLeg?.driver ?? null
        if (driver !== null) {
          logger.warn({ text: text.slice(0, 80) }, 'browser refused playback — speaking natively')
          driver.speak(text)
        } else {
          logger.warn({ text: text.slice(0, 80) }, 'browser refused playback and no voice is loaded; nothing was heard')
        }
      },
      // stop_listening / the sidecar's Stop — the native conversation ends and
      // the daemon waits for the next wake.
      onStopListening: () => {
        logger.info('stop listening — the native conversation ends')
        nativeLeg?.driver.stopListening()
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
    nativeLeg?.stop()
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
    abandonHandoff: () => nativeLeg?.driver.endHandoff(),
  })

  function startMicrophoneLeg(): NativeLeg | null {
    return startNativeLeg({
      env,
      logger,
      slot,
      overlay,
      recognizer: serializedRecognizer,
      transcribeCommand: sharedSessionTranscribe,
      synthesizer: sharedSynthesizer,
      wakeHandoff: wakeHandoff.handoff,
    })
  }
  if (slot.isReady) nativeLeg = startMicrophoneLeg()
  logger.info(
    { apiUrl: env.VYNEL_API_URL, voice: slot.isReady, microphone: nativeLeg !== null },
    'voice daemon up',
  )

  // The boot read raced a still-starting engine: the daemon is on the env
  // stand-in, while Settings truthfully shows the user's saved pick. Keep
  // asking until the engine answers once, then apply — otherwise a cloud
  // pick silently speaks the local voice after every app restart.
  let selectionSettle: { done: Promise<void>; cancel: () => void } | null = null
  if (bootRead === null) {
    logger.warn('engine not answering yet — the saved voice pick applies as soon as it does')
    selectionSettle = settleVoiceSelectionWithEngine({
      read: () => fetchVoiceSelection({ apiUrl: env.VYNEL_API_URL, fallback: envSelection }),
      apply: (settled) => {
        const outcome = slot.apply(settled)
        if (outcome.ready && nativeLeg === null) nativeLeg = startMicrophoneLeg()
        logger.info(
          { ttsSource: outcome.ttsSource, sttSource: outcome.sttSource, changed: outcome.changed },
          'engine answered — the saved voice pick is in force',
        )
      },
    })
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'voice daemon shutting down')
    selectionSettle?.cancel()
    wakeHandoff.stop()
    callRegistry.stopAll()
    nativeLeg?.stop()
    overlay.stop()
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

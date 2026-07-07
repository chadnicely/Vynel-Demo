// The Vynel voice daemon — an always-on background sidecar. It listens on the
// mic, wakes on "Hey Vynel", runs a multi-turn conversation against the brain
// (local-api `/root/turn`), speaks the answers, and falls back asleep on silence.
// Everything on the CPU, no Python. Run with local-api up: `pnpm --filter
// @vynel/voice-daemon dev`.

import pino from 'pino'
import { SherpaSpeechRecognizer, SherpaVoiceActivityDetector, SherpaVoiceEngine } from '@vynel/voice-engine'
import { loadEnv } from './env.js'
import {
  findMissingModelFile,
  resolveSttConfig,
  resolveTtsConfig,
  resolveVadConfig,
} from './models.js'
import { createBrainClient } from './brain/run-brain-turn.js'
import { createAudioShell } from './audio/audio-shell.js'
import { VoiceSessionDriver } from './loop/voice-session-driver.js'

function main(): void {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  const ttsConfig = resolveTtsConfig(env.VYNEL_VOICE_MODELS_DIR, env.VYNEL_VOICE_TTS)
  const sttConfig = resolveSttConfig(env.VYNEL_VOICE_MODELS_DIR)
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

  logger.info({ tts: env.VYNEL_VOICE_TTS }, 'loading voice models on CPU…')
  const synthesizer = new SherpaVoiceEngine({ tts: ttsConfig })
  const recognizer = new SherpaSpeechRecognizer({ stt: sttConfig })
  const vad = new SherpaVoiceActivityDetector({ vad: vadConfig })
  logger.info({ voices: synthesizer.voiceCount, sampleRate: synthesizer.sampleRate }, 'models loaded')

  // audioShell needs the drained callback (→ driver), and the driver needs the
  // shell's `io` — so build the shell first with a late-bound driver reference.
  let driver!: VoiceSessionDriver
  const audioShell = createAudioShell(logger, () => driver.notifyPlaybackDrained())
  driver = new VoiceSessionDriver(
    { vad, recognizer, synthesizer, runBrainTurn: createBrainClient(env.VYNEL_API_URL), io: audioShell.io },
    { idleTimeoutMs: env.VYNEL_VOICE_IDLE_TIMEOUT_MS, voiceId: env.VYNEL_VOICE_ID },
  )

  audioShell.start((audio) => {
    void driver.pushAudio(audio)
  })
  logger.info({ apiUrl: env.VYNEL_API_URL }, 'voice daemon listening — say "Hey Vynel"')

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'voice daemon shutting down')
    audioShell.stop()
    driver.stop()
    // eslint-disable-next-line n/no-process-exit -- explicit exit at the end of a graceful shutdown
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()

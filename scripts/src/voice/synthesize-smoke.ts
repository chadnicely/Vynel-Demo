import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SherpaVoiceEngine, writeWavFile } from '@vynel/voice-engine'
import { DEFAULT_VOICE_MODEL, resolveVoiceModel, voiceModelsDir } from './voice-models.js'

// Increment-1 smoke: load a real TTS model on CPU, synthesize a phrase, write a
// WAV for Chad to play. This is the manual gate — a real ONNX model can't ride
// `pnpm test`. Usage: `pnpm voice:smoke [model] ["phrase"]`.

const DEFAULT_PHRASE = "Hello, I'm Vynel. The voice engine is working, and it's all running on your CPU."

async function main(): Promise<void> {
  const name = process.argv[2] ?? DEFAULT_VOICE_MODEL
  const phrase = process.argv[3] ?? DEFAULT_PHRASE
  const entry = resolveVoiceModel(name)
  if (entry.kind !== 'tts') {
    throw new Error(`"${name}" is a ${entry.kind} model — the smoke synthesizes, so pass a TTS model.`)
  }
  const baseDir = join(voiceModelsDir, entry.folder)

  if (!existsSync(baseDir)) {
    throw new Error(`model "${name}" not found at ${baseDir}. Run: pnpm voice:fetch-models ${name}`)
  }

  console.log(`[voice:smoke] loading "${name}" on CPU …`)
  const startedAt = performance.now()
  const engine = new SherpaVoiceEngine({ tts: entry.toTtsConfig(baseDir) })
  console.log(`[voice:smoke] loaded in ${Math.round(performance.now() - startedAt)} ms — ${engine.voiceCount} voice(s) @ ${engine.sampleRate} Hz`)

  const synthAt = performance.now()
  const audio = await engine.synthesize(phrase, { voiceId: 0 })
  const synthMs = Math.round(performance.now() - synthAt)
  const audioSeconds = audio.samples.length / audio.sampleRate
  const realtimeFactor = (synthMs / 1000 / audioSeconds).toFixed(2)

  const outPath = join(voiceModelsDir, 'vynel-smoke.wav')
  writeWavFile(outPath, audio)

  console.log(`[voice:smoke] synthesized ${audioSeconds.toFixed(1)}s of audio in ${synthMs} ms (RTF ${realtimeFactor}, <1 is faster-than-realtime)`)
  console.log(`[voice:smoke] wrote ${outPath} — play it.`)
}

main().catch((error: unknown) => {
  console.error(`[voice:smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

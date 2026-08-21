import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_MODELS, type LocalModelEntry } from '@vynel/contracts/models/local-model-catalog'
import { probeInstalledModel } from '@vynel/models'
import {
  SherpaSpeechRecognizer,
  SherpaVoiceEngine,
  readWavFile,
  resolveSttConfig,
  resolveTtsConfig,
} from '@vynel/voice-engine'
import type { PcmAudio } from '@vynel/voice-engine'
import { voiceModelsDir } from './voice-models-dir.js'

// Measure the real-time factor (RTF = processing time ÷ audio duration) of each
// downloaded model on THIS CPU — RTF < 1 means faster than realtime. Warms each
// model, then times the median of a few runs. TTS runs first so its audio feeds
// the STT benchmark. Usage: `pnpm voice:bench`.

const PHRASE =
  'The quick brown fox jumps over the lazy dog, while Vynel runs its own voice entirely on the CPU.'
const RUNS = 3

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function reportRow(name: string, kind: string, loadMs: number, audioS: number, procMs: number, note: string): void {
  const rtf = procMs / 1000 / audioS
  console.log(
    `  ${name.padEnd(16)} ${kind.padEnd(4)} ${String(Math.round(loadMs)).padStart(7)}  ${audioS.toFixed(1).padStart(7)}  ${String(Math.round(procMs)).padStart(7)}  ${rtf.toFixed(3).padStart(6)}  ${note}`,
  )
}

async function benchmarkTts(entry: LocalModelEntry): Promise<PcmAudio> {
  const startedAt = performance.now()
  const engine = new SherpaVoiceEngine({ tts: resolveTtsConfig(voiceModelsDir, entry) })
  const loadMs = performance.now() - startedAt
  await engine.synthesize('warm up the model')

  const times: number[] = []
  let audio: PcmAudio = { samples: new Float32Array(1), sampleRate: engine.sampleRate }
  for (let i = 0; i < RUNS; i += 1) {
    const runStart = performance.now()
    audio = await engine.synthesize(PHRASE)
    times.push(performance.now() - runStart)
  }
  const audioSeconds = audio.samples.length / audio.sampleRate
  reportRow(entry.id, 'tts', loadMs, audioSeconds, median(times), `${engine.voiceCount} voice(s) @ ${engine.sampleRate}Hz`)
  return audio
}

async function benchmarkStt(entry: LocalModelEntry, input: PcmAudio): Promise<void> {
  const startedAt = performance.now()
  const recognizer = new SherpaSpeechRecognizer({ stt: resolveSttConfig(voiceModelsDir, entry) })
  const loadMs = performance.now() - startedAt
  await recognizer.transcribe(input)

  const times: number[] = []
  let text = ''
  for (let i = 0; i < RUNS; i += 1) {
    const runStart = performance.now()
    text = await recognizer.transcribe(input)
    times.push(performance.now() - runStart)
  }
  const audioSeconds = input.samples.length / input.sampleRate
  const preview = text.length > 44 ? `${text.slice(0, 44)}…` : text
  reportRow(entry.id, 'stt', loadMs, audioSeconds, median(times), `heard: "${preview}"`)
}

async function installedVoiceModels(): Promise<LocalModelEntry[]> {
  const present: LocalModelEntry[] = []
  for (const entry of LOCAL_MODELS) {
    if (entry.kind === 'embedding') continue
    if ((await probeInstalledModel(voiceModelsDir, entry)).installed) present.push(entry)
  }
  return present
}

async function main(): Promise<void> {
  const present = await installedVoiceModels()
  if (present.length === 0) {
    throw new Error('No models present. Run: pnpm voice:fetch-models [piper-lessac|moonshine-tiny|kokoro]')
  }

  console.log(`\n  Voice engine RTF benchmark — CPU, median of ${RUNS} runs (RTF < 1 = faster than realtime)\n`)
  console.log('  model            kind  load(ms)  audio(s)  proc(ms)    RTF  note')
  console.log(`  ${'─'.repeat(74)}`)

  const ttsEntries = present.filter((entry) => entry.kind === 'tts')
  const sttEntries = present.filter((entry) => entry.kind === 'stt')

  // TTS first so a freshly-synthesized utterance can feed the STT benchmark.
  let sttInput: PcmAudio | undefined
  for (const entry of ttsEntries) sttInput = await benchmarkTts(entry)

  if (sttEntries.length > 0) {
    const smokeWav = join(voiceModelsDir, 'vynel-smoke.wav')
    if (sttInput === undefined && existsSync(smokeWav)) sttInput = readWavFile(smokeWav)
    if (sttInput === undefined) {
      console.log('\n  (STT skipped — needs a TTS model present or a prior `pnpm voice:smoke` WAV to transcribe.)')
    } else {
      for (const entry of sttEntries) await benchmarkStt(entry, sttInput)
    }
  }
  console.log('')
}

main().catch((error: unknown) => {
  console.error(`[voice:bench] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

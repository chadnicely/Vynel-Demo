// Record EXACTLY what a call app hears from "Vynel Call 1 Microphone" — run
// this DURING a live call test, then listen to the WAV yourself:
//   clean + loud here, garbled on the far end  → the loss is inside the call
//     app (its processing/codec) or beyond — not Vynel's chain;
//   already low/garbled here                   → the loss is on our side of
//     the endpoint, and this file is the evidence to debug against.
//   node --import tsx smoke-record-mic.mts [seconds]   (default 20)
import { writeFileSync } from 'node:fs'
import { cpal } from './src/audio/cpal.js'
import { encodeWav } from './src/audio/wav-encode.js'
import { downmixToMono } from './src/audio/audio-format.js'

const seconds = Number(process.argv[2] ?? 20)
const mic = cpal.getDevices().find((d) => /vynel call 1 microphone/i.test(d.name))
if (!mic) {
  console.error('Vynel Call 1 Microphone not found — is the driver installed?')
  process.exit(2)
}
const config = cpal.getDefaultInputConfig(mic.deviceId)
console.log(`recording "${mic.name}" (${config.sampleRate}Hz x${config.channels}) for ${seconds}s…`)

const chunks: Float32Array[] = []
let secondPeak = 0
let secondSum = 0
let secondSamples = 0
let lastReportAt = Date.now()
const handle = cpal.createStream(mic.deviceId, true, config, (frame: Float32Array) => {
  chunks.push(frame.slice())
  for (const sample of frame) {
    const magnitude = Math.abs(sample)
    if (magnitude > secondPeak) secondPeak = magnitude
    secondSum += sample * sample
    secondSamples += 1
  }
  if (Date.now() - lastReportAt >= 1000) {
    const rms = Math.sqrt(secondSum / Math.max(1, secondSamples))
    console.log(`  peak=${secondPeak.toFixed(3)} rms=${rms.toFixed(4)}${secondPeak < 0.01 ? '  (silence)' : ''}`)
    secondPeak = 0
    secondSum = 0
    secondSamples = 0
    lastReportAt = Date.now()
  }
})

setTimeout(() => {
  cpal.closeStream(handle)
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const interleaved = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    interleaved.set(chunk, offset)
    offset += chunk.length
  }
  const mono = downmixToMono(interleaved, config.channels)
  const file = `call-mic-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`
  writeFileSync(file, encodeWav({ samples: mono, sampleRate: config.sampleRate }))
  console.log(`wrote ${file} (${(mono.length / config.sampleRate).toFixed(1)}s) — LISTEN to it.`)
  process.exit(0)
}, seconds * 1000)

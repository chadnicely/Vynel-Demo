// VM smoke for the Vynel Call Audio loopback cable: play a tone INTO the render
// endpoint ("Vynel Call 1 Voice") and record it back OUT of the capture endpoint
// ("Vynel Call 1 Microphone"). If the driver's render->capture ring works, the
// recording is non-silent. Run in the VM (Windows node) after loading + signing
// the driver per LOADING.md:
//   node drivers\windows\vynel-call-audio\smoke-cable.mjs [seconds]
//
// It reuses node-cpal from the voice app (same binding the daemon uses), so a
// pass here means the daemon's own capture/output path will carry the call too.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '..', '..', '..', 'apps', 'voice') + '/')
const cpal = require('node-cpal')

const VOICE_NAME = 'vynel call 1 voice' // render — we play into it
const MIC_NAME = 'vynel call 1 microphone' // capture — the loop comes out here
const seconds = Number(process.argv[2] ?? 4)
const TONE_HZ = 440

function findDevice(prefix) {
  const wanted = prefix.toLowerCase()
  return cpal.getDevices().find((d) => d.name.trim().toLowerCase().startsWith(wanted)) ?? null
}

const voice = findDevice(VOICE_NAME)
const mic = findDevice(MIC_NAME)
if (voice === null || mic === null) {
  const have = cpal.getDevices().map((d) => d.name).join(', ') || '(none)'
  console.error(
    `driver endpoints not found — is the Vynel Call Audio driver loaded?\n` +
      `  need: "Vynel Call 1 Voice" (render) + "Vynel Call 1 Microphone" (capture)\n` +
      `  have: ${have}`,
  )
  process.exit(2)
}

const outConfig = cpal.getDefaultOutputConfig(voice.deviceId)
const inConfig = cpal.getDefaultInputConfig(mic.deviceId)
console.log(
  `playing ${TONE_HZ}Hz into "${voice.name}" (${outConfig.sampleRate}Hz x${outConfig.channels}), ` +
    `recording "${mic.name}" (${inConfig.sampleRate}Hz x${inConfig.channels}) for ${seconds}s…`,
)

// Feed ~50 ms of interleaved tone per tick to keep the render endpoint fed.
let tonePhase = 0
const chunkFrames = Math.round(outConfig.sampleRate * 0.05)
function nextToneChunk() {
  const out = new Float32Array(chunkFrames * outConfig.channels)
  for (let f = 0; f < chunkFrames; f += 1) {
    const sample = Math.sin(2 * Math.PI * TONE_HZ * (tonePhase / outConfig.sampleRate)) * 0.3
    tonePhase += 1
    for (let c = 0; c < outConfig.channels; c += 1) out[f * outConfig.channels + c] = sample
  }
  return out
}

let frames = 0
let samples = 0
let peak = 0
let sumSquares = 0
const micHandle = cpal.createStream(mic.deviceId, true, inConfig, (data) => {
  frames += 1
  samples += data.length
  for (const s of data) {
    const a = Math.abs(s)
    if (a > peak) peak = a
    sumSquares += s * s
  }
})
const voiceHandle = cpal.createStream(voice.deviceId, false, outConfig, () => {})
const feed = setInterval(() => cpal.writeToStream(voiceHandle, nextToneChunk()), 50)

setTimeout(() => {
  clearInterval(feed)
  cpal.closeStream(voiceHandle)
  cpal.closeStream(micHandle)
  const rms = Math.sqrt(sumSquares / Math.max(1, samples))
  const nonSilent = peak > 0.01
  console.log(
    JSON.stringify({ frames, samples, peak: Number(peak.toFixed(4)), rms: Number(rms.toFixed(4)), nonSilent }),
  )
  console.log(nonSilent ? 'PASS — audio looped render->capture through the driver.' : 'FAIL — capture was silent.')
  process.exit(nonSilent ? 0 : 1)
}, seconds * 1000)

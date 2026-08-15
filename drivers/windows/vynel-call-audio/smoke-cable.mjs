// Smoke for the Vynel Call Audio loopback cable: play a tone INTO the render
// endpoint ("Vynel Call 1 Voice") and record it back OUT of the capture endpoint
// ("Vynel Call 1 Microphone"). PASS needs the recording non-silent AND at the
// played pitch — the pitch check catches format-folding bugs (raw byte copy of
// stereo frames into a mono stream halves the frequency; amplitude alone can't
// see that). Run on Windows node after loading + signing per LOADING.md:
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
// Pitch estimate on channel 0: the MEDIAN half-period between zero crossings
// (with hysteresis). The capture is tone bursts separated by silence gaps —
// the WASAPI engine renders silence whenever the JS feed timer is late — so a
// crossings-per-second rate reads far low (measured ~5x). Gaps contribute one
// huge interval each; the median ignores them and reads the in-burst pitch.
let lastSign = 0
let monoIndex = 0
let lastCrossingIndex = -1
const halfPeriods = []
const ACTIVE_LEVEL = 0.05
const micHandle = cpal.createStream(mic.deviceId, true, inConfig, (data) => {
  frames += 1
  samples += data.length
  for (const s of data) {
    const a = Math.abs(s)
    if (a > peak) peak = a
    sumSquares += s * s
  }
  for (let f = 0; f < data.length; f += inConfig.channels) {
    const s = data[f]
    if (Math.abs(s) >= ACTIVE_LEVEL) {
      const sign = s > 0 ? 1 : -1
      if (lastSign !== 0 && sign !== lastSign) {
        if (lastCrossingIndex >= 0) halfPeriods.push(monoIndex - lastCrossingIndex)
        lastCrossingIndex = monoIndex
      }
      lastSign = sign
    }
    monoIndex += 1
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
  halfPeriods.sort((a, b) => a - b)
  const medianHalfPeriod = halfPeriods.length > 0 ? halfPeriods[Math.floor(halfPeriods.length / 2)] : 0
  const estimatedHz = medianHalfPeriod > 0 ? inConfig.sampleRate / (2 * medianHalfPeriod) : 0
  const pitchOk = halfPeriods.length > 100 && Math.abs(estimatedHz - TONE_HZ) / TONE_HZ < 0.1
  console.log(
    JSON.stringify({
      frames,
      samples,
      peak: Number(peak.toFixed(4)),
      rms: Number(rms.toFixed(4)),
      nonSilent,
      crossingIntervals: halfPeriods.length,
      estimatedHz: Number(estimatedHz.toFixed(1)),
      pitchOk,
    }),
  )
  if (nonSilent && pitchOk) {
    console.log('PASS — audio looped render->capture through the driver at the played pitch.')
  } else if (!nonSilent) {
    console.log('FAIL — capture was silent.')
  } else {
    console.log(
      `FAIL — audio looped but at ~${estimatedHz.toFixed(0)}Hz instead of ${TONE_HZ}Hz — ` +
        `the ring is mangling the format (channel/rate fold bug).`,
    )
  }
  process.exit(nonSilent && pitchOk ? 0 : 1)
}, seconds * 1000)

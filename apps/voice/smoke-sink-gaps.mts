// Where exactly are the cuts? Emit like real TTS — sentences with think-gaps
// between them — through the REAL sink, and list every silent gap in the audio
// that comes back off the cable.
import { openOutputSink } from './src/audio/output-sink.js'
import { cpal } from './src/audio/cpal.js'

const TONE = 440, AMP = 0.3, RATE = 24000

const devices = cpal.getDevices()
const voice = devices.find((d) => /vynel call 1 voice/i.test(d.name))!
const mic = devices.find((d) => /vynel call 1 microphone/i.test(d.name))!
const outConfig = cpal.getDefaultOutputConfig(voice.deviceId)
const inConfig = cpal.getDefaultInputConfig(mic.deviceId)

let n = 0, firstAudio = -1, lastAudio = -1
let run = 0
const gaps: { atMs: number; ms: number }[] = []
const toMs = (samples: number) => samples / inConfig.channels / inConfig.sampleRate * 1000
let audible = 0
let lastSign = 0, lastCrossing = -1
const halfPeriods: number[] = []
const micHandle = cpal.createStream(mic.deviceId, true, inConfig, (data: Float32Array) => {
  for (const s of data) {
    if (Math.abs(s) >= 0.05) {
      const sign = s > 0 ? 1 : -1
      if (lastSign !== 0 && sign !== lastSign) {
        if (lastCrossing >= 0) halfPeriods.push(n - lastCrossing)
        lastCrossing = n
      }
      lastSign = sign
    }
    if (Math.abs(s) >= 0.02) {
      audible++
      if (firstAudio < 0) firstAudio = n
      lastAudio = n
      // A real dropout, not a zero crossing (a 440Hz zero crossing is ~0.07ms).
      if (run > 0 && toMs(run) > 100) gaps.push({ atMs: +toMs(n - run - firstAudio).toFixed(0), ms: +toMs(run).toFixed(1) })
      run = 0
    } else if (firstAudio >= 0) run++
    n++
  }
})

const noop = () => {}
const sink = openOutputSink({ info: noop, debug: noop, warn: noop, error: noop } as never,
  'gaps', { device: voice, config: outConfig }, noop)

let phase = 0
function sentence(seconds: number) {
  const samples = new Float32Array(Math.round(RATE * seconds))
  for (let i = 0; i < samples.length; i++) { samples[i] = Math.sin(2 * Math.PI * TONE * (phase / RATE)) * AMP; phase++ }
  return { samples, sampleRate: RATE }
}

// The REAL line-speaker pattern: synthesize a sentence (slow), emit it, then
// synthesize the next. The queue genuinely empties between sentences, which is
// the case that exercises the keepalive. 1.0 s of audio every 1.6 s leaves
// ~600 ms of true idle — any gap LONGER than that is silence we added.
const SENTENCE_SEC = 1.0
const EVERY_MS = 1600
const COUNT = 4
let i = 0
function speakNext() {
  if (i >= COUNT) { sink.endSpeech(); return }
  sink.emitAudio(sentence(SENTENCE_SEC))
  i++
  setTimeout(speakNext, EVERY_MS)
}
speakNext()

setTimeout(() => {
  sink.stop(); cpal.closeStream(micHandle)
  const total = SENTENCE_SEC * COUNT
  console.log(JSON.stringify({
    emittedSeconds: total,
    audibleSpanMs: +toMs(lastAudio - firstAudio).toFixed(0), expectedMs: 6300,
    // ~96% of a 0.3 sine's samples clear the 0.02 gate, so 5.5s of tone
    // should read ~5.3s of content however it is spread out.
    audibleContentSec: +(toMs(audible) / 1000).toFixed(2),
    estimatedHz: (() => {
      halfPeriods.sort((a, b) => a - b)
      const m = halfPeriods[Math.floor(halfPeriods.length / 2)] ?? 0
      return m > 0 ? +(inConfig.sampleRate / (2 * m)).toFixed(1) : 0
    })(),
    gapCount: gaps.length,
    gapMsTotal: +gaps.reduce((a, g) => a + g.ms, 0).toFixed(0),
  }))
  console.log('first 25 gaps:', JSON.stringify(gaps.slice(0, 25)))
  process.exit(0)
}, 9000)

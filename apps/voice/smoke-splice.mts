// Does the cable splice packets under CPU load? Play a continuous tone into
// "Vynel Call 1 Voice" through the REAL sink, record "Vynel Call 1
// Microphone", and count step discontinuities that a pure tone cannot
// contain. Run idle, then with load:
//   node --import tsx smoke-splice.mts          (idle)
//   node --import tsx smoke-splice.mts load     (4 busy-spin workers)
import { Worker } from 'node:worker_threads'
import { openOutputSink } from './src/audio/output-sink.js'
import { cpal } from './src/audio/cpal.js'

const TONE = 440
const AMP = 0.3
const SECONDS = 6
const withLoad = process.argv[2] === 'load'

const devices = cpal.getDevices()
const voice = devices.find((d) => /vynel call 1 voice/i.test(d.name))
const mic = devices.find((d) => /vynel call 1 microphone/i.test(d.name))
if (!voice || !mic) {
  console.error('driver endpoints not found')
  process.exit(2)
}
const outConfig = cpal.getDefaultOutputConfig(voice.deviceId)
const inConfig = cpal.getDefaultInputConfig(mic.deviceId)

const workers: Worker[] = []
if (withLoad) {
  for (let i = 0; i < 4; i++) {
    workers.push(
      new Worker('let x = 0; for (;;) { x = (x + 1) % 1e9 }', { eval: true }),
    )
  }
  console.log('4 busy-spin workers running')
}

const captured: Float32Array[] = []
const micHandle = cpal.createStream(mic.deviceId, true, inConfig, (frame: Float32Array) => {
  captured.push(frame.slice())
})

const noop = () => {}
const sink = openOutputSink(
  { info: noop, debug: noop, warn: noop, error: noop } as never,
  'splice-smoke',
  { device: voice, config: outConfig },
  noop,
)

// One continuous emit: the sink queue + pump own the pacing.
const samples = new Float32Array(24_000 * SECONDS)
for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * TONE * i) / 24_000) * AMP
sink.emitAudio({ samples, sampleRate: 24_000 })

setTimeout(() => {
  sink.stop()
  cpal.closeStream(micHandle)
  for (const worker of workers) void worker.terminate()

  let total = 0
  for (const chunk of captured) total += chunk.length
  const s = new Float32Array(total)
  let offset = 0
  for (const chunk of captured) {
    s.set(chunk, offset)
    offset += chunk.length
  }
  let first = -1
  let last = -1
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(s[i]!) >= 0.02) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) {
    console.log(JSON.stringify({ error: 'captured silence' }))
    process.exit(1)
  }
  // A 440 Hz tone at 0.3 slews at most 2*pi*f*A/rate ~ 0.017 per sample at
  // 48k. Any jump 5x that is a splice, not the tone.
  const JUMP = 0.09
  const jumps: { atMs: number; jump: number }[] = []
  let zeroRunSamples = 0
  let run = 0
  for (let i = first + 1; i <= last; i++) {
    const d = Math.abs(s[i]! - s[i - 1]!)
    if (d > JUMP) jumps.push({ atMs: +(((i - first) / inConfig.sampleRate) * 1000).toFixed(1), jump: +d.toFixed(3) })
    if (s[i] === 0) run++
    else {
      if (run >= inConfig.sampleRate * 0.001) zeroRunSamples += run
      run = 0
    }
  }
  const grid = jumps.map((j) => +(j.atMs % 10).toFixed(1))
  console.log(
    JSON.stringify({
      load: withLoad,
      capturedSec: +(total / inConfig.sampleRate).toFixed(1),
      toneSpanSec: +((last - first) / inConfig.sampleRate).toFixed(1),
      spliceJumps: jumps.length,
      zeroFillMs: Math.round((zeroRunSamples / inConfig.sampleRate) * 1000),
      first10: jumps.slice(0, 10),
      gridOffsets: grid.slice(0, 20),
    }),
  )
  process.exit(0)
}, (SECONDS + 2) * 1000)

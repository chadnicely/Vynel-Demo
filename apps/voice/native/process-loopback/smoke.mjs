// Live smoke for the process-loopback addon: capture a target process's audio
// by PID for a few seconds and report whether non-silent frames arrived.
// Usage: node smoke.mjs <pid> [seconds]  (Windows only, addon must be built)
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const addon = require(resolve(here, 'build', 'process-loopback.node'))

const pid = Number(process.argv[2])
const seconds = Number(process.argv[3] ?? 4)
if (!Number.isInteger(pid) || pid <= 0) {
  console.error('usage: node smoke.mjs <pid> [seconds]')
  process.exit(2)
}

let frames = 0
let samples = 0
let peak = 0
let sumSquares = 0
const handle = addon.start(pid, true, (frame) => {
  frames += 1
  samples += frame.length
  for (const s of frame) {
    const a = Math.abs(s)
    if (a > peak) peak = a
    sumSquares += s * s
  }
})

console.log(`capturing pid ${pid} for ${seconds}s at ${addon.captureSampleRate}Hz x${addon.captureChannels}…`)
setTimeout(() => {
  addon.stop(handle)
  addon.stop(handle) // second stop must be a safe no-op, not a use-after-free
  const rms = Math.sqrt(sumSquares / Math.max(1, samples))
  const secondsCaptured = samples / addon.captureChannels / addon.captureSampleRate
  console.log(
    JSON.stringify({
      frames,
      samples,
      secondsCaptured: Number(secondsCaptured.toFixed(2)),
      peak: Number(peak.toFixed(4)),
      rms: Number(rms.toFixed(4)),
      nonSilent: peak > 0.001,
    }),
  )
  process.exit(peak > 0.001 ? 0 : 1)
}, seconds * 1000)

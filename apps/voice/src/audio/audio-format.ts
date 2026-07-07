// Sample-rate + channel conversion between the audio device and the models.
// The mic gives whatever the device's default config is; VAD/STT need 16 kHz
// mono. TTS gives the model's rate mono; the speaker wants the device's rate +
// channels. Pure + unit-tested — linear interpolation is plenty for speech.

/** Linear-resample mono float samples from one rate to another. Linear (rather
 *  than box-averaging) downsampling preserves the high-frequency energy speech
 *  consonants live in — box-averaging dulled the audio and STT dropped MORE words
 *  (Chad live-smoke, 2026-07-07). */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples
  const ratio = toRate / fromRate
  const outLength = Math.max(1, Math.round(samples.length * ratio))
  const out = new Float32Array(outLength)
  const lastIndex = samples.length - 1
  for (let i = 0; i < outLength; i += 1) {
    const src = i / ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, lastIndex)
    const frac = src - i0
    out[i] = (samples[i0] ?? 0) * (1 - frac) + (samples[i1] ?? 0) * frac
  }
  return out
}

/** Average interleaved multi-channel frames down to mono. */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved
  const frames = Math.floor(interleaved.length / channels)
  const out = new Float32Array(frames)
  for (let f = 0; f < frames; f += 1) {
    let sum = 0
    for (let c = 0; c < channels; c += 1) sum += interleaved[f * channels + c] ?? 0
    out[f] = sum / channels
  }
  return out
}

/** Duplicate mono frames across N interleaved channels. */
export function monoToChannels(mono: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return mono
  const out = new Float32Array(mono.length * channels)
  for (let f = 0; f < mono.length; f += 1) {
    const sample = mono[f] ?? 0
    for (let c = 0; c < channels; c += 1) out[f * channels + c] = sample
  }
  return out
}

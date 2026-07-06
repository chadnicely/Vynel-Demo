import { readWave, writeWave } from './native.js'
import type { PcmAudio } from '../voice-engine.js'

// Read/write mono PCM .wav files via sherpa-onnx's native codec. Diagnostic
// helpers (the live loop streams PCM to the browser, it never touches disk) —
// but they keep `sherpa-onnx-node` imported ONLY inside this package, so smoke
// and benchmark scripts use the contract, not the native lib.
export function writeWavFile(filePath: string, audio: PcmAudio): void {
  writeWave(filePath, { samples: audio.samples, sampleRate: audio.sampleRate })
}

export function readWavFile(filePath: string): PcmAudio {
  const wave = readWave(filePath)
  return { samples: wave.samples, sampleRate: wave.sampleRate }
}

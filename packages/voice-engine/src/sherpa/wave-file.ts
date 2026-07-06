import { writeWave } from './native.js'
import type { PcmAudio } from '../voice-engine.js'

// Write mono PCM to a .wav file via sherpa-onnx's native writer. A diagnostic
// helper (the live loop streams PCM to the browser, it never touches disk) —
// but it keeps `sherpa-onnx-node` imported ONLY inside this package, so the
// smoke script and any debugging code use the contract, not the native lib.
export function writeWavFile(filePath: string, audio: PcmAudio): void {
  writeWave(filePath, { samples: audio.samples, sampleRate: audio.sampleRate })
}

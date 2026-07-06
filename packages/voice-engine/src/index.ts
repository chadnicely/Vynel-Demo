// `@vynel/voice-engine` — the model-agnostic STT/TTS engine for Vynel voice.
// Increment 1: text-to-speech via sherpa-onnx-node (native, CPU, no Python).
// The `VoiceEngine` contract is the stable seam; `SherpaVoiceEngine` is the
// first backend. STT + wake-word land in Increment 2; an optional Python
// LuxTTS/Chatterbox backend plugs in behind the same contract later.
export type { PcmAudio, SynthesizeOptions, VoiceEngine, TtsModelConfig } from './voice-engine.js'
export { SherpaVoiceEngine } from './sherpa/sherpa-voice-engine.js'
export type { SherpaVoiceEngineOptions } from './sherpa/sherpa-voice-engine.js'
export { writeWavFile } from './sherpa/wave-file.js'

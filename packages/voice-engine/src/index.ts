// `@vynel/voice-engine` — the model-agnostic STT/TTS engine for Vynel voice,
// via sherpa-onnx-node (native, CPU, no Python). `VoiceEngine`/`SpeechRecognizer`
// are the stable seams; `SherpaVoiceEngine` (TTS) + `SherpaSpeechRecognizer`
// (Moonshine STT) are the first backends. Wake-word (KWS) + the live loop land
// next; an optional Python LuxTTS/Chatterbox backend plugs in behind the same
// contracts later.
export type {
  PcmAudio,
  SynthesizeOptions,
  VoiceEngine,
  TtsModelConfig,
  SpeechRecognizer,
  SttModelConfig,
  VoiceActivityDetector,
  VadModelConfig,
} from './voice-engine.js'
export { ElevenLabsVoiceEngine } from './elevenlabs/elevenlabs-voice-engine.js'
export type { ElevenLabsVoiceEngineOptions } from './elevenlabs/elevenlabs-voice-engine.js'
export { ElevenLabsSpeechRecognizer } from './elevenlabs/elevenlabs-speech-recognizer.js'
export type { ElevenLabsSpeechRecognizerOptions } from './elevenlabs/elevenlabs-speech-recognizer.js'
export { GoogleVoiceEngine } from './google/google-voice-engine.js'
export type { GoogleVoiceEngineOptions } from './google/google-voice-engine.js'
export { GoogleSpeechRecognizer } from './google/google-speech-recognizer.js'
export type { GoogleSpeechRecognizerOptions } from './google/google-speech-recognizer.js'
export { VoiceProviderRequestError } from './voice-provider-request-error.js'
export { encodeWavFromPcm, decodeWavToPcm, int16BytesToFloat32 } from './pcm-codec.js'
export { SherpaVoiceEngine } from './sherpa/sherpa-voice-engine.js'
export type { SherpaVoiceEngineOptions } from './sherpa/sherpa-voice-engine.js'
export { SherpaSpeechRecognizer } from './sherpa/sherpa-speech-recognizer.js'
export type { SherpaSpeechRecognizerOptions } from './sherpa/sherpa-speech-recognizer.js'
export { SherpaVoiceActivityDetector } from './sherpa/sherpa-voice-activity-detector.js'
export type { SherpaVoiceActivityDetectorOptions } from './sherpa/sherpa-voice-activity-detector.js'
export { writeWavFile, readWavFile } from './sherpa/wave-file.js'
export { resolveSttConfig, resolveTtsConfig, resolveVadConfig } from './model-configs.js'

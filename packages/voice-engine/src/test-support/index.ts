// Test doubles for consumers of `@vynel/voice-engine` — imported as
// `@vynel/voice-engine/test-support`. Kept off the main barrel so production
// code can never reach a fake by accident.
export { FakeVoiceEngine } from './fake-voice-engine.js'

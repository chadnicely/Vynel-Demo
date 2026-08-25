export {
  listVoiceProviderConnectionsForUser,
  findVoiceProviderConnection,
  type VoiceProviderConnection,
} from './repositories/index.js'
export { connectVoiceProvider, type ConnectVoiceProviderInput } from './lifecycle/connect-voice-provider.js'
export { disconnectVoiceProvider } from './lifecycle/disconnect-voice-provider.js'
export { openVoiceProviderCredentials } from './credentials/open-voice-provider-credentials.js'
export {
  VoiceProviderAdapter,
  type VerifyVoiceProviderCredentialsResult,
} from './adapters/voice-provider-adapter.js'
export { resolveVoiceProviderAdapter } from './adapters/voice-provider-adapter-registry.js'
export {
  VOICE_PROVIDER_CONNECTED,
  VOICE_PROVIDER_DISCONNECTED,
  type VoiceProviderConnectedPayload,
  type VoiceProviderDisconnectedPayload,
} from './voice-provider-events.js'
export type { StructuralLogger, VoiceProviderCredentials } from './voice-provider-types.js'

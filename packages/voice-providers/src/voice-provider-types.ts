// Shared types for the voice-providers domain. The credential shape is a
// single API key for every provider we ship — both ElevenLabs and Google
// authenticate with one header value. If a future provider needs more
// (region, project id), this widens to a per-provider union.

export interface VoiceProviderCredentials {
  readonly apiKey: string
}

export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

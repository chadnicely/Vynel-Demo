// The typed fault a cloud backend throws when the provider call fails —
// carries WHICH provider and the HTTP status (null = never reached it) so
// callers can distinguish "reconnect the key" (auth) from "provider down"
// (fall back to the local engine / surface honestly). The message is safe
// to log: the API key travels only in request headers and never lands here.

import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'

export class VoiceProviderRequestError extends Error {
  constructor(
    readonly provider: VoiceProviderId,
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'VoiceProviderRequestError'
  }

  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403
  }
}

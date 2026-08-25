// Outbox event type constants + payload interfaces for the voice-providers
// domain. Connection facts co-commit with the row change. Payloads are
// loose-ref FACTS — the API key NEVER enters a payload.

import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'

export const VOICE_PROVIDER_CONNECTED = 'voice.provider-connected' as const
export const VOICE_PROVIDER_DISCONNECTED = 'voice.provider-disconnected' as const

type VoiceProviderEventBase = {
  connectionId: string
  userId: string
  provider: VoiceProviderId
}

export type VoiceProviderConnectedPayload = VoiceProviderEventBase & { connectedAt: string }
export type VoiceProviderDisconnectedPayload = VoiceProviderEventBase & { disconnectedAt: string }

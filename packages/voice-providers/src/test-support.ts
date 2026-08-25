// Test factories for the voice-providers domain. The fake master key is a
// REAL 32-byte AES key (all-sevens) so seal/open round-trips genuinely —
// per house rule, the crypto is never mocked, only the network is.

import { randomUUID } from 'node:crypto'
import {
  VoiceProviderAdapter,
  type VerifyVoiceProviderCredentialsResult,
} from './adapters/voice-provider-adapter.js'
import type { VoiceProviderId, VoiceProviderVoice } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderCredentials } from './voice-provider-types.js'

export const TEST_MASTER_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64')

export function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

export class FakeVoiceProviderAdapter extends VoiceProviderAdapter {
  readonly providerId: VoiceProviderId
  verifyResult: VerifyVoiceProviderCredentialsResult
  voices: VoiceProviderVoice[] = []
  seenCredentials: VoiceProviderCredentials[] = []

  constructor(
    providerId: VoiceProviderId = 'elevenlabs',
    verifyResult: VerifyVoiceProviderCredentialsResult = { kind: 'valid', accountLabel: null },
  ) {
    super()
    this.providerId = providerId
    this.verifyResult = verifyResult
  }

  async verifyCredentials(input: {
    credentials: VoiceProviderCredentials
  }): Promise<VerifyVoiceProviderCredentialsResult> {
    this.seenCredentials.push(input.credentials)
    return this.verifyResult
  }

  async listVoices(): Promise<VoiceProviderVoice[]> {
    return this.voices
  }
}

// The abstract `VoiceProviderAdapter` contract — one concrete class per
// cloud voice provider, resolved via the registry (channels'
// `ChannelAdapter` precedent). Adapters hold NO credentials: the key is
// passed per call and never stored on the instance. Audio synthesis and
// transcription are NOT here — they live behind the `VoiceEngine` /
// `SpeechRecognizer` contracts in `@vynel/voice-engine`; this adapter
// covers the account-management half (verify a key, list voices).

import type { VoiceProviderId, VoiceProviderVoice } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderCredentials } from '../voice-provider-types.js'

export type VerifyVoiceProviderCredentialsResult =
  | { kind: 'valid'; accountLabel: string | null }
  | { kind: 'invalid'; reasonMessage: string }

export abstract class VoiceProviderAdapter {
  abstract readonly providerId: VoiceProviderId

  /** Verify the key over the network — connect persists ONLY on `valid`. */
  abstract verifyCredentials(input: {
    credentials: VoiceProviderCredentials
  }): Promise<VerifyVoiceProviderCredentialsResult>

  /** The provider's speakable voices, for the Settings picker. */
  abstract listVoices(input: {
    credentials: VoiceProviderCredentials
  }): Promise<VoiceProviderVoice[]>
}

// The ONLY read of the sealed blob. Server-side use exclusively — the
// engine-side synthesize / transcribe / list-voices paths open the key in
// memory for one outbound call; no route ever returns it and no other
// surface exists (the ssh-servers stance: rotation = reconnect).

import { ValidationError } from '@vynel/errors'
import { openSecret } from '@vynel/sealing'
import { findVoiceProviderConnection } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderCredentials } from '../voice-provider-types.js'

export function openVoiceProviderCredentials(
  db: Database,
  input: { userId: string; provider: VoiceProviderId },
  deps: { masterKeyBase64: string },
): VoiceProviderCredentials | null {
  const connection = findVoiceProviderConnection(db, input)
  if (!connection) return null

  // A wrong master key or tampered blob throws inside openSecret (GCM
  // auth) — that is "credentials unreadable", never "empty credentials".
  let apiKey: string
  try {
    const opened = JSON.parse(
      openSecret(deps.masterKeyBase64, connection.encryptedCredentials),
    ) as { apiKey?: unknown }
    if (typeof opened.apiKey !== 'string' || opened.apiKey.length === 0) {
      throw new Error('sealed payload is missing the apiKey')
    }
    apiKey = opened.apiKey
  } catch {
    throw new ValidationError(
      `The stored ${input.provider} credentials could not be read — ` +
        'disconnect and reconnect the provider in Settings → Voice.',
    )
  }
  return { apiKey }
}

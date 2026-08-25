// Core op — connect a cloud voice provider. The key arrives ONCE, is
// verified over the network (via the adapter) BEFORE anything persists,
// then sealed immediately against the master key. Reconnecting the same
// provider upserts — that IS key rotation. Row change + the
// `voice.provider-connected` outbox event co-commit in ONE transaction.
//
// async (the verify is a network call); the tx callback itself is sync —
// better-sqlite3 rejects async tx callbacks.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { sealSecret } from '@vynel/sealing'
import { getVoiceProviderCatalogEntry } from '@vynel/contracts/voice/voice-providers'
import * as voiceProvidersRepository from '../repositories/index.js'
import {
  VOICE_PROVIDER_CONNECTED,
  type VoiceProviderConnectedPayload,
} from '../voice-provider-events.js'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderConnection } from '../repositories/index.js'
import type { VoiceProviderAdapter } from '../adapters/voice-provider-adapter.js'
import type { StructuralLogger, VoiceProviderCredentials } from '../voice-provider-types.js'

export interface ConnectVoiceProviderInput {
  userId: string
  provider: VoiceProviderId
  credentials: VoiceProviderCredentials
}

export async function connectVoiceProvider(
  db: Database,
  input: ConnectVoiceProviderInput,
  deps: { masterKeyBase64: string; adapter: VoiceProviderAdapter; logger?: StructuralLogger },
): Promise<VoiceProviderConnection> {
  // A mis-paired adapter would verify against one provider and persist the
  // connection under another — a programmer error, so it fails loud.
  if (deps.adapter.providerId !== input.provider) {
    throw new Error(
      `connectVoiceProvider: a ${deps.adapter.providerId} adapter cannot connect ${input.provider}`,
    )
  }
  const apiKey = input.credentials.apiKey.trim()
  if (apiKey.length === 0) {
    throw new ValidationError('The API key is required.')
  }

  const providerLabel = getVoiceProviderCatalogEntry(input.provider).label
  const verification = await deps.adapter.verifyCredentials({ credentials: { apiKey } })
  if (verification.kind !== 'valid') {
    throw new ValidationError(
      `Could not connect ${providerLabel}: ${verification.reasonMessage}. ` +
        'Check the API key and try again.',
    )
  }

  const now = new Date()
  const sealedCredentials = sealSecret(deps.masterKeyBase64, JSON.stringify({ apiKey }))
  const existing = voiceProvidersRepository.findVoiceProviderConnection(db, {
    userId: input.userId,
    provider: input.provider,
  })

  const connection = withTransaction(db, (tx) => {
    const row = existing
      ? voiceProvidersRepository.updateVoiceProviderConnection(tx, existing.id, {
          encryptedCredentials: sealedCredentials,
          accountLabel: verification.accountLabel,
          updatedAt: now,
        })
      : voiceProvidersRepository.insertVoiceProviderConnection(tx, {
          id: randomUUID(),
          userId: input.userId,
          provider: input.provider,
          encryptedCredentials: sealedCredentials,
          accountLabel: verification.accountLabel,
          createdAt: now,
          updatedAt: now,
        })

    const payload: VoiceProviderConnectedPayload = {
      connectionId: row.id,
      userId: row.userId,
      provider: row.provider,
      connectedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: VOICE_PROVIDER_CONNECTED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return row
  })

  // The key NEVER enters a log line — ids and provider names only.
  deps.logger?.info(
    { connectionId: connection.id, provider: connection.provider },
    'voice provider connected',
  )
  return connection
}

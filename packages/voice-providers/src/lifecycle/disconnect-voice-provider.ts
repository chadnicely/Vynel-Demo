// Core op — disconnect a provider: hard-delete the row (the sealed key
// with it) + the `voice.provider-disconnected` outbox event in ONE
// transaction. sync.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as voiceProvidersRepository from '../repositories/index.js'
import {
  VOICE_PROVIDER_DISCONNECTED,
  type VoiceProviderDisconnectedPayload,
} from '../voice-provider-events.js'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import type { StructuralLogger } from '../voice-provider-types.js'

export function disconnectVoiceProvider(
  db: Database,
  input: { userId: string; provider: VoiceProviderId },
  deps: { logger?: StructuralLogger } = {},
): void {
  const existing = voiceProvidersRepository.findVoiceProviderConnection(db, input)
  if (!existing) {
    throw new NotFoundError('voice provider connection', input.provider)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    voiceProvidersRepository.hardDeleteVoiceProviderConnection(tx, existing.id)
    const payload: VoiceProviderDisconnectedPayload = {
      connectionId: existing.id,
      userId: existing.userId,
      provider: existing.provider,
      disconnectedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: VOICE_PROVIDER_DISCONNECTED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info(
    { connectionId: existing.id, provider: existing.provider },
    'voice provider disconnected',
  )
}

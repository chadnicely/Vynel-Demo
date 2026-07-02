// Set the user's default provider. Atomic — inside one transaction it clears
// every `isDefault` flag for the user, then sets the chosen (userId, providerId)
// row's flag (upsert), preserving the "exactly one default per user" invariant.
//
// Synchronous in Phase 1 (SQLite owns a transaction); Phase 2 Postgres flips
// only the async/Promise annotations.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import * as providerPreferencesRepository from '@vynel/db/repositories/providers'
import type { Database } from '@vynel/db'
import type { ProviderDefaultSettings } from '@vynel/db/repositories/providers'
import type { AiAgentProviderId } from '@vynel/providers'

export type SetDefaultProviderForUserInput = {
  userId: string
  providerId: AiAgentProviderId
  /** Initial settings if a fresh preference row is created. Ignored on update. */
  initialSettings?: ProviderDefaultSettings
}

export function setDefaultProviderForUser(
  db: Database,
  input: SetDefaultProviderForUserInput,
): void {
  withTransaction(db, (tx) => {
    const existing = providerPreferencesRepository.findProviderPreferenceForUserAndProvider(
      tx,
      input.userId,
      input.providerId,
    )

    providerPreferencesRepository.clearDefaultProviderPreferenceForUser(tx, input.userId)

    if (existing !== null) {
      providerPreferencesRepository.updateProviderPreference(tx, existing.id, { isDefault: true })
      return
    }

    const now = new Date()
    providerPreferencesRepository.insertProviderPreference(tx, {
      id: randomUUID(),
      userId: input.userId,
      providerId: input.providerId,
      isDefault: true,
      defaultSettings: input.initialSettings ?? {},
      createdAt: now,
      updatedAt: now,
    })
  })
}

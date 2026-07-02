// The user's explicitly-chosen default provider, or `null` when they have not
// set one — the null-returning raw read. `getDefaultProviderForUser` is the
// non-null sibling that falls back to DEFAULT_PROVIDER_ID ('claude').
//
// Synchronous in Phase 1 (SQLite repo read); Phase 2 Postgres flips only the
// async/Promise annotations.

import * as providerPreferencesRepository from '@vynel/db/repositories/providers'
import type { Database } from '@vynel/db'
import type { AiAgentProviderId } from '@vynel/providers'

export function findDefaultProviderForUser(db: Database, userId: string): AiAgentProviderId | null {
  const preference = providerPreferencesRepository.findDefaultProviderPreferenceForUser(db, userId)
  if (preference === null) return null
  // The stored `providerId` was validated by the write op; the cast is safe.
  return preference.providerId as AiAgentProviderId
}

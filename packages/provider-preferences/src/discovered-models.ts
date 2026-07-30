// The provider's DISCOVERED model roster — what the engine reported it serves,
// captured from the session-initialize response on every interactive turn and
// read back by `GET /providers/:providerId/models` (the model picker's
// source). Stored inside `defaultSettings.providerSpecific` (the opaque
// per-provider blob — never queried inside, per the schema's contract);
// context windows and grouping are derived at READ time in contracts, so the
// stored shape stays lean.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import * as providerPreferencesRepository from '@vynel/db/repositories/providers'
import type { Database } from '@vynel/db'
import type { DiscoveredChatModel } from '@vynel/contracts/chat/available-models'
import type { AiAgentProviderId } from '@vynel/providers'

const DISCOVERED_MODELS_KEY = 'discoveredModels'

export type RecordDiscoveredModelsInput = {
  userId: string
  providerId: AiAgentProviderId
  models: DiscoveredChatModel[]
}

/** Persist the roster the engine just reported. No-ops on an empty roster
 *  (never wipe a good roster with a degraded answer) and on an unchanged one
 *  (every turn calls this — the common case must not churn the row). */
export function recordDiscoveredModels(db: Database, input: RecordDiscoveredModelsInput): void {
  if (input.models.length === 0) return
  // Stored sorted by id so the unchanged-check is order-blind (an engine that
  // reorders its list must not churn the row every turn). Display order is
  // derived at read time (groupAvailableModels), so storage order is free.
  const models = [...input.models].sort((a, b) => a.id.localeCompare(b.id))
  withTransaction(db, (tx) => {
    const existing = providerPreferencesRepository.findProviderPreferenceForUserAndProvider(
      tx,
      input.userId,
      input.providerId,
    )
    if (existing !== null) {
      const stored = existing.defaultSettings.providerSpecific?.[DISCOVERED_MODELS_KEY]
      if (JSON.stringify(stored) === JSON.stringify(models)) return
      providerPreferencesRepository.updateProviderPreference(tx, existing.id, {
        defaultSettings: {
          ...existing.defaultSettings,
          providerSpecific: {
            ...existing.defaultSettings.providerSpecific,
            [DISCOVERED_MODELS_KEY]: models,
          },
        },
      })
      return
    }
    const now = new Date()
    providerPreferencesRepository.insertProviderPreference(tx, {
      id: randomUUID(),
      userId: input.userId,
      providerId: input.providerId,
      isDefault: false,
      defaultSettings: { providerSpecific: { [DISCOVERED_MODELS_KEY]: models } },
      createdAt: now,
      updatedAt: now,
    })
  })
}

/** The last roster the engine reported — null before the first discovery
 *  (callers fall back to the contracts' static floor). Shape-checked on read:
 *  a corrupt blob degrades to null, never to a broken picker. */
export function findDiscoveredModels(
  db: Database,
  userId: string,
  providerId: AiAgentProviderId,
): DiscoveredChatModel[] | null {
  const preference = providerPreferencesRepository.findProviderPreferenceForUserAndProvider(
    db,
    userId,
    providerId,
  )
  const stored = preference?.defaultSettings.providerSpecific?.[DISCOVERED_MODELS_KEY]
  if (!Array.isArray(stored) || stored.length === 0) return null
  const models = stored
    .filter(
      (entry): entry is DiscoveredChatModel =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as DiscoveredChatModel).id === 'string' &&
        typeof (entry as DiscoveredChatModel).label === 'string',
    )
    // Normalize the optional fields — a partial blob (an older writer's shape)
    // must still serve the full contract, `null` never `undefined` (the wire
    // schema promises nullable keys and responses aren't runtime-parsed).
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description ?? null,
      supportedEffortLevels: entry.supportedEffortLevels ?? null,
    }))
  return models.length > 0 ? models : null
}

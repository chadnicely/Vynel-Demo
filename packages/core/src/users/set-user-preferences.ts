// Plural — accepts a partial `ResolvedUserPreferences`-shaped object and
// upserts each provided key in a single sync transaction (Phase 1).
// Routes call this ONCE with the validated payload; no per-key dispatch
// in the route layer. Per `docs/blueprints/users/blueprint.md §5.5` +
// `docs/blueprints/users/coding.md §1.4`.

import { upsertPreferenceForUser } from '@vynel/db/repositories/users'
import { withTransaction, type Database } from '@vynel/db'
import { ValidationError } from '@vynel/core/errors'
import type { ResolvedUserPreferences } from './get-user-preferences.js'

// Properties match Zod's `.optional()` output (`T | undefined`) under
// `exactOptionalPropertyTypes: true`. The for-loop filters undefined
// before serializing.
export type SetUserPreferencesInput = {
  [K in keyof ResolvedUserPreferences]?: ResolvedUserPreferences[K] | undefined
}

export function setUserPreferences(
  db: Database,
  userId: string,
  input: SetUserPreferencesInput,
): void {
  withTransaction(db, (tx) => {
    for (const [preferenceKey, preferenceValue] of Object.entries(input)) {
      if (preferenceValue === undefined) continue
      const serialized = JSON.stringify(preferenceValue)
      if (serialized === undefined) {
        throw new ValidationError(
          `Invalid value for preference ${preferenceKey}. The value could not be JSON-encoded; pass a serializable value.`,
        )
      }
      upsertPreferenceForUser(tx, userId, preferenceKey, serialized)
    }
  })
}

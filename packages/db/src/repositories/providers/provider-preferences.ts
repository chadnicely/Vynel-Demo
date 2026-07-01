// Functional repository for the `provider_preferences` table. `db` is the
// first argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/providers/blueprint.md §4`.
//
// Phase 1 SYNC return values (no Promise<T>) — required by the
// better-sqlite3 transaction contract per
// `.claude/memory/decisions/phase-1-sync-transactions.md`. Phase 2 Postgres
// flips the signatures to async; call sites already use `await` which is
// harmless on sync return values.

import { and, eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  providerPreferences,
  type ProviderPreference,
  type NewProviderPreference,
  type ProviderDefaultSettings,
} from '../../schema/providers/provider-preferences.js'

export type {
  ProviderPreference,
  NewProviderPreference,
  ProviderDefaultSettings,
} from '../../schema/providers/provider-preferences.js'

export function findProviderPreferenceForUserAndProvider(
  db: Database,
  userId: string,
  providerId: string,
): ProviderPreference | null {
  const [row] = db
    .select()
    .from(providerPreferences)
    .where(
      and(eq(providerPreferences.userId, userId), eq(providerPreferences.providerId, providerId)),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function findDefaultProviderPreferenceForUser(
  db: Database,
  userId: string,
): ProviderPreference | null {
  const [row] = db
    .select()
    .from(providerPreferences)
    .where(and(eq(providerPreferences.userId, userId), eq(providerPreferences.isDefault, true)))
    .limit(1)
    .all()
  return row ?? null
}

export function listProviderPreferencesForUser(db: Database, userId: string): ProviderPreference[] {
  return db.select().from(providerPreferences).where(eq(providerPreferences.userId, userId)).all()
}

export function insertProviderPreference(
  db: Database,
  newProviderPreference: NewProviderPreference,
): ProviderPreference {
  const [inserted] = db.insert(providerPreferences).values(newProviderPreference).returning().all()
  if (!inserted) {
    throw new Error('insertProviderPreference: no row returned')
  }
  return inserted
}

// Returns `null` when no row has `providerPreferenceId` — matches the
// `updateUser` / `updateWorkspace` repo precedent: a not-found update is data,
// not an internal-invariant violation, and the core layer translates the
// `null` to a typed error if a caller ever needs it.
export function updateProviderPreference(
  db: Database,
  providerPreferenceId: string,
  patch: Partial<Omit<NewProviderPreference, 'id' | 'userId' | 'providerId' | 'createdAt'>>,
): ProviderPreference | null {
  const [updated] = db
    .update(providerPreferences)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(providerPreferences.id, providerPreferenceId))
    .returning()
    .all()
  return updated ?? null
}

// Flips every `isDefault: true` row for the user back to false. The
// `setDefaultProviderForUser` core op (blueprint §5.5) calls this inside a
// transaction, then sets the chosen (userId, providerId) row's `isDefault`
// true — preserving the "exactly one default per user" invariant.
//
// blueprint §4 sketched this as `clearIsDefaultForUserExcept(db, userId,
// exceptId)`, but its own body ignored `exceptId` (the §5.5 core op clears
// all, then re-sets the target). Implemented here as the clear-all shape the
// behaviour actually needs — the vestigial param is dropped.
export function clearDefaultProviderPreferenceForUser(db: Database, userId: string): void {
  db.update(providerPreferences)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(providerPreferences.userId, userId), eq(providerPreferences.isDefault, true)))
    .run()
}

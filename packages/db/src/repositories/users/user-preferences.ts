// Functional repository for the `user_preferences` table. Phase 1
// contract spec in `docs/blueprints/users/blueprint.md §4.2`. Phase 1
// sync semantics — see the Phase 1 sync-tx workaround in
// `.claude/memory/MEMORY.md` "Technical workarounds".
//
// Values are JSON-encoded strings — the repo takes the encoded `string`
// and trusts the caller (the core layer in `setUserPreferences`) has
// encoded them. See `docs/blueprints/users/coding.md §1.3`.

import { and, eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { userPreferences, type UserPreference } from '../../schema/users/user-preferences.js'

export type { UserPreference, NewUserPreference } from '../../schema/users/user-preferences.js'

export function listPreferencesForUser(db: Database, userId: string): UserPreference[] {
  return db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).all()
}

export function findPreferenceForUser(
  db: Database,
  userId: string,
  preferenceKey: string,
): UserPreference | null {
  const [row] = db
    .select()
    .from(userPreferences)
    .where(
      and(eq(userPreferences.userId, userId), eq(userPreferences.preferenceKey, preferenceKey)),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function upsertPreferenceForUser(
  db: Database,
  userId: string,
  preferenceKey: string,
  preferenceValue: string,
): UserPreference {
  const [row] = db
    .insert(userPreferences)
    .values({
      userId,
      preferenceKey,
      preferenceValue,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userPreferences.userId, userPreferences.preferenceKey],
      set: { preferenceValue, updatedAt: new Date() },
    })
    .returning()
    .all()
  if (!row) {
    throw new Error('upsertPreferenceForUser: no row returned')
  }
  return row
}

export function deletePreferenceForUser(
  db: Database,
  userId: string,
  preferenceKey: string,
): boolean {
  const result = db
    .delete(userPreferences)
    .where(
      and(eq(userPreferences.userId, userId), eq(userPreferences.preferenceKey, preferenceKey)),
    )
    .run()
  return result.changes > 0
}

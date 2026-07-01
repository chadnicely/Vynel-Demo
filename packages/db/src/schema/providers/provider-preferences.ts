// The `provider_preferences` table — one row per (user, provider) pair,
// capturing the user's chosen default provider and opaque per-provider
// settings. Every row carries `userId` per the locked Phase 1 → Phase 2
// multi-user-ready rule. Spec: `docs/blueprints/providers/blueprint.md §3.1`.
//
// Phase 1 SYNC discipline applies — see
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// No `deletedAt` column — preferences are user-edited config; "delete" means
// revert to provider defaults, which is what a missing row already means.
// The `isDefault` single-true-row-per-user invariant is enforced by the
// `setDefaultProviderForUser` core op (an atomic flip), NOT a partial index —
// SQLite and Postgres differ on partial-index support. See blueprint §3.1.

import { table, id, text, timestamp, boolean, json, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '../users/users.js'

// Opaque per-provider settings blob — JSON, never filtered on (per
// `.claude/rules/data-standard.md` "Schema"). The providers domain never
// queries inside it.
export type ProviderDefaultSettings = {
  /** The user's default permission mode for chat sessions on this provider. */
  permissionMode?: 'ask' | 'bypass-with-behavior-gate' | 'plan-only'
  /** Provider-specific opaque settings — typed differently per provider. */
  providerSpecific?: Record<string, unknown>
}

export const providerPreferences = table(
  'provider_preferences',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // 'claude' | 'codex' | 'gemini' | 'cursor' — validated at the application
    // layer (Zod), not the DB layer, to avoid a SQLite/Postgres CHECK divergence.
    providerId: text().notNull(),
    isDefault: boolean().notNull(),
    defaultSettings: json<ProviderDefaultSettings>().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userIdIdx: index('idx_provider_preferences_user_id').on(t.userId),
    userProviderUniqueIdx: uniqueIndex('uidx_provider_preferences_user_provider').on(
      t.userId,
      t.providerId,
    ),
  }),
)

export type ProviderPreference = typeof providerPreferences.$inferSelect
export type NewProviderPreference = typeof providerPreferences.$inferInsert

// Returns the single local user, creating one (with OS-detected defaults)
// on first call. Idempotent — second call returns the same row.
//
// Allowlist: this function MUST ONLY be called from
//   - `apps/local-api/src/server.ts` (boot)
//   - `apps/local-api/src/middleware/user-resolver.ts` (request resolver)
// Anywhere else reads `c.var.user` (in routes) or accepts `userId` as
// input. Per `docs/blueprints/users/coding.md §1.1` + decisions D7.
//
// Phase 1 sync transaction (see `.claude/memory/MEMORY.md` "Technical
// workarounds").

import { randomUUID } from 'node:crypto'
import { findSingleLocalUser, insertUser, type User } from '@vynel/db/repositories/users'
import { upsertPreferenceForUser } from '@vynel/db/repositories/users'
import { withTransaction, type Database } from '@vynel/db'
import { detectOsLocale, detectOsTimezone, detectOsUsername } from './os-detection.js'

export interface GetOrCreateLocalUserDependencies {
  readonly logger?: { info: (obj: object, msg: string) => void }
}

export function getOrCreateLocalUser(
  db: Database,
  deps: GetOrCreateLocalUserDependencies = {},
): User {
  const existing = findSingleLocalUser(db)
  if (existing) return existing

  // First run — create the local user with OS-detected defaults + seed
  // the most-likely-to-be-explicitly-set preferences (per decision D5).
  return withTransaction(db, (tx) => {
    const now = new Date()
    const newUser = insertUser(tx, {
      id: randomUUID(),
      displayName: detectOsUsername() ?? 'You',
      emailAddress: null,
      locale: detectOsLocale(),
      timezone: detectOsTimezone(),
      hasCompletedOnboarding: false,
      createdAt: now,
      updatedAt: now,
    })
    upsertPreferenceForUser(tx, newUser.id, 'theme', JSON.stringify('system'))
    upsertPreferenceForUser(tx, newUser.id, 'chatStreamingEnabled', JSON.stringify(true))
    upsertPreferenceForUser(tx, newUser.id, 'reducedMotion', JSON.stringify(false))
    deps.logger?.info({ userId: newUser.id }, 'local user created on first run')
    return newUser
  })
}

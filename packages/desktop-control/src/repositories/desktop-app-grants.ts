// Functional repository for the `desktop_app_grants` table. `db` first arg,
// Phase 1 SYNC. App names arrive pre-normalized (`normalizeDesktopAppKey` is
// the one gate — the access ops call it before reaching here).

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { randomUUID } from 'node:crypto'
import { desktopAppGrants, type DesktopAppGrantRow } from '../schema/desktop-app-grants.js'
import type { DesktopAccessTier } from '../access/desktop-access-tiers.js'

export type { DesktopAppGrantRow, NewDesktopAppGrantRow } from '../schema/desktop-app-grants.js'

export function findDesktopAppGrant(
  db: Database,
  userId: string,
  appName: string,
): DesktopAppGrantRow | null {
  const rows = db
    .select()
    .from(desktopAppGrants)
    .where(and(eq(desktopAppGrants.userId, userId), eq(desktopAppGrants.appName, appName)))
    .limit(1)
    .all()
  return rows[0] ?? null
}

export function listDesktopAppGrants(db: Database, userId: string): DesktopAppGrantRow[] {
  return db
    .select()
    .from(desktopAppGrants)
    .where(eq(desktopAppGrants.userId, userId))
    .orderBy(asc(desktopAppGrants.appName))
    .all()
}

export function insertDesktopAppGrant(
  db: Database,
  input: { userId: string; appName: string; tier: DesktopAccessTier; now: Date },
): DesktopAppGrantRow {
  const [inserted] = db
    .insert(desktopAppGrants)
    .values({
      id: randomUUID(),
      userId: input.userId,
      appName: input.appName,
      tier: input.tier,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .all()
  if (!inserted) {
    throw new Error('insertDesktopAppGrant: no row returned')
  }
  return inserted
}

export function updateDesktopAppGrantTier(
  db: Database,
  input: { id: string; tier: DesktopAccessTier; now: Date },
): void {
  db.update(desktopAppGrants)
    .set({ tier: input.tier, updatedAt: input.now })
    .where(eq(desktopAppGrants.id, input.id))
    .run()
}

/** Deletes the grant row; returns the deleted row or null when none existed. */
export function deleteDesktopAppGrant(
  db: Database,
  userId: string,
  appName: string,
): DesktopAppGrantRow | null {
  const rows = db
    .delete(desktopAppGrants)
    .where(and(eq(desktopAppGrants.userId, userId), eq(desktopAppGrants.appName, appName)))
    .returning()
    .all()
  return rows[0] ?? null
}

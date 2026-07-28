// Functional repository for the `server_installs` table. `db` first arg,
// Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { desc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { serverInstalls, type ServerInstall, type NewServerInstall } from '../schema/server-installs.js'

export type {
  ServerInstall,
  NewServerInstall,
  ServerInstallStatus,
  ServerInstallStep,
  ServerAuthKind,
} from '../schema/server-installs.js'

const LIST_LIMIT = 20

export function listServerInstallsForUser(db: Database, userId: string): ServerInstall[] {
  return db
    .select()
    .from(serverInstalls)
    .where(eq(serverInstalls.userId, userId))
    .orderBy(desc(serverInstalls.createdAt))
    .limit(LIST_LIMIT)
    .all()
}

export function findServerInstallById(db: Database, id: string): ServerInstall | null {
  const [row] = db.select().from(serverInstalls).where(eq(serverInstalls.id, id)).limit(1).all()
  return row ?? null
}

export function insertServerInstall(db: Database, row: NewServerInstall): ServerInstall {
  const [inserted] = db.insert(serverInstalls).values(row).returning().all()
  if (!inserted) throw new Error('insertServerInstall: no row returned')
  return inserted
}

export function updateServerInstall(
  db: Database,
  id: string,
  patch: Partial<NewServerInstall>,
): ServerInstall {
  const [updated] = db
    .update(serverInstalls)
    .set(patch)
    .where(eq(serverInstalls.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateServerInstall: no row for ${id}`)
  return updated
}

export function hardDeleteServerInstall(db: Database, id: string): void {
  db.delete(serverInstalls).where(eq(serverInstalls.id, id)).run()
}

// Functional repository for the `ssh_servers` table. `db` first arg; Phase 1
// SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { sshServers, type SshServer, type NewSshServer } from '../schema/ssh-servers.js'

export type { SshServer, NewSshServer, SshAuthKind } from '../schema/ssh-servers.js'

const LIST_LIMIT = 50

// Both scopes (global + every workspace) — the section filters client-side
// like schedules; the tools resolve visibility per turn.
export function listSshServersForUser(db: Database, userId: string): SshServer[] {
  return db
    .select()
    .from(sshServers)
    .where(eq(sshServers.userId, userId))
    .orderBy(asc(sshServers.createdAt))
    .limit(LIST_LIMIT)
    .all()
}

export function findSshServerByName(
  db: Database,
  input: { userId: string; name: string },
): SshServer | null {
  const [row] = db
    .select()
    .from(sshServers)
    .where(
      and(
        eq(sshServers.userId, input.userId),
        sql`lower(${sshServers.name}) = lower(${input.name})`,
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function findSshServerById(db: Database, id: string): SshServer | null {
  const [row] = db.select().from(sshServers).where(eq(sshServers.id, id)).limit(1).all()
  return row ?? null
}

export function insertSshServer(db: Database, row: NewSshServer): SshServer {
  const [inserted] = db.insert(sshServers).values(row).returning().all()
  if (!inserted) throw new Error('insertSshServer: no row returned')
  return inserted
}

export function updateSshServer(
  db: Database,
  id: string,
  patch: Partial<NewSshServer>,
): SshServer {
  const [updated] = db
    .update(sshServers)
    .set(patch)
    .where(eq(sshServers.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateSshServer: no row for ${id}`)
  return updated
}

export function hardDeleteSshServer(db: Database, id: string): void {
  db.delete(sshServers).where(eq(sshServers.id, id)).run()
}

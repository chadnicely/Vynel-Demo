// Functional repository for the `users` table. `db` is the first argument
// (per `docs/foundation.md §2 row 3` + always-on `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/users/blueprint.md §4.1`.
//
// Phase 1: SYNC return values (no Promise<T>) — required by the
// better-sqlite3 transaction contract documented in
// `.claude/memory/MEMORY.md` "Technical workarounds". Phase 2 Postgres
// swap flips the signatures to async; call sites already use `await`
// which is harmless on sync return values.

import { eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { users, type User, type NewUser } from '../../schema/users/users.js'

export type { User, NewUser } from '../../schema/users/users.js'

export function findUserById(db: Database, userId: string): User | null {
  const [row] = db.select().from(users).where(eq(users.id, userId)).limit(1).all()
  return row ?? null
}

export function getUserByIdOrThrow(db: Database, userId: string): User {
  const found = findUserById(db, userId)
  if (!found) {
    throw new Error(`getUserByIdOrThrow: user ${userId} not found`)
  }
  return found
}

export function findSingleLocalUser(db: Database): User | null {
  // Phase 1: at most one user exists. Returns that user or null.
  const [row] = db.select().from(users).limit(1).all()
  return row ?? null
}

export function listAllUsers(db: Database): User[] {
  // Phase 1: returns 0 or 1 users. Phase 2: returns all users.
  return db.select().from(users).all()
}

export function insertUser(db: Database, newUser: NewUser): User {
  const [inserted] = db.insert(users).values(newUser).returning().all()
  if (!inserted) {
    throw new Error('insertUser: no row returned')
  }
  return inserted
}

export type UpdateUserPatch = {
  [K in keyof Omit<User, 'id' | 'createdAt'>]?: Omit<User, 'id' | 'createdAt'>[K] | undefined
}

export function updateUser(db: Database, userId: string, patch: UpdateUserPatch): User | null {
  const [updated] = db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
    .all()
  return updated ?? null
}

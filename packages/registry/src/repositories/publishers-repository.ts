// Functional publishers repository — `db` first arg, stateless, async.

import { eq } from 'drizzle-orm'
import type { CloudDatabase } from '@vynel/cloud-db'
import { publishers, type PublisherRow } from '../schema/publishers.js'

export interface UpsertPublisherInput {
  readonly id: string
  readonly name: string
  readonly tier: string
  readonly url?: string | null
}

export async function upsertPublisher(
  db: CloudDatabase,
  input: UpsertPublisherInput,
): Promise<PublisherRow> {
  const rows = await db
    .insert(publishers)
    .values({ id: input.id, name: input.name, tier: input.tier, url: input.url ?? null })
    .onConflictDoUpdate({
      target: publishers.id,
      set: { name: input.name, tier: input.tier, url: input.url ?? null },
    })
    .returning()
  return rows[0] as PublisherRow
}

export async function findPublisherById(
  db: CloudDatabase,
  id: string,
): Promise<PublisherRow | null> {
  const rows = await db.select().from(publishers).where(eq(publishers.id, id)).limit(1)
  return rows[0] ?? null
}

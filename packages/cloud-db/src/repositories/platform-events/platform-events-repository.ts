// Functional platform-events repository — `db` first arg, stateless, async.

import { sql } from 'drizzle-orm'
import type { CloudDatabase } from '../../client.js'
import { platformEvents } from '../../schema/accounts/platform-events.js'

/**
 * Claim an event id for processing. Returns true if THIS call won the insert
 * (proceed to apply), false if the id was already recorded (a duplicate/
 * replay — skip). Atomic via ON CONFLICT DO NOTHING, so two concurrent
 * deliveries of the same id can't both apply.
 */
export async function claimPlatformEvent(
  db: CloudDatabase,
  input: { readonly eventId: string; readonly type: string; readonly platformUserId: string },
): Promise<boolean> {
  const inserted = await db
    .insert(platformEvents)
    .values({
      eventId: input.eventId,
      type: input.type,
      platformUserId: input.platformUserId,
    })
    .onConflictDoNothing({ target: platformEvents.eventId })
    .returning({ eventId: platformEvents.eventId })
  return inserted.length > 0
}

/** Test/ops helper: has this event id been processed? */
export async function hasProcessedPlatformEvent(
  db: CloudDatabase,
  eventId: string,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(platformEvents)
    .where(sql`${platformEvents.eventId} = ${eventId}`)
    .limit(1)
  return rows.length > 0
}

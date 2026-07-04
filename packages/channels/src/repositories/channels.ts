// Functional repository for the `channels` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3`). Phase 1 SYNC return
// values per `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// Spec: `docs/blueprints/channels/blueprint.md §4`.

import { asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  channels,
  type Channel,
  type NewChannel,
  type ChannelKind,
  type ChannelConnectionStatus,
} from '../schema/channels.js'

// Re-export row + union types so `@vynel/core/channels` imports them via
// `@vynel/db/repositories/channels` (the workspaces/chat repo precedent).
export type {
  Channel,
  NewChannel,
  ChannelKind,
  ChannelConnectionStatus,
} from '../schema/channels.js'

// Bounded list (1–3 channels/user in Phase 1) but capped defensively per
// coding-standard.md "Structure / patterns".
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

export function findChannelById(db: Database, id: string): Channel | null {
  const [row] = db.select().from(channels).where(eq(channels.id, id)).limit(1).all()
  return row ?? null
}

export function listChannelsForWorkspace(
  db: Database,
  workspaceId: string,
  options: { limit?: number } = {},
): Channel[] {
  const cap = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(channels)
    .where(eq(channels.workspaceId, workspaceId))
    .orderBy(asc(channels.createdAt))
    .limit(cap)
    .all()
}

// The user's channels (brain-tree Ch4) — the global root's send targets, since
// the global root has no workspace. Mirrors listChannelsForWorkspace by userId.
export function listChannelsForUser(
  db: Database,
  userId: string,
  options: { limit?: number } = {},
): Channel[] {
  const cap = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return db
    .select()
    .from(channels)
    .where(eq(channels.userId, userId))
    .orderBy(asc(channels.createdAt))
    .limit(cap)
    .all()
}

// The polling loop's input — every enabled channel across all users.
export function listEnabledChannels(db: Database): Channel[] {
  return db.select().from(channels).where(eq(channels.isEnabled, true)).all()
}

export function insertChannel(db: Database, row: NewChannel): Channel {
  const [inserted] = db.insert(channels).values(row).returning().all()
  if (!inserted) throw new Error('insertChannel: no row returned')
  return inserted
}

// Auto-sets `updatedAt`. The core layer null-checks via findChannelById
// first; a missing row here is an internal invariant violation → plain
// Error (error-handling.md repo layer).
export function updateChannel(
  db: Database,
  id: string,
  patch: Partial<Omit<Channel, 'id' | 'userId' | 'workspaceId' | 'createdAt' | 'updatedAt'>>,
): Channel {
  const [updated] = db
    .update(channels)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(channels.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateChannel: no row for id ${id}`)
  return updated
}

// Hard delete — cascades to channel_user_links / channel_inbound_messages /
// channel_message_queue via the FK on-delete-cascade (D16). Idempotent.
export function hardDeleteChannel(db: Database, id: string): void {
  db.delete(channels).where(eq(channels.id, id)).run()
}

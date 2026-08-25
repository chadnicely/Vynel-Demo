// Functional repository for the `voice_provider_connections` table. `db`
// first arg; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside
// this repo.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import {
  voiceProviderConnections,
  type VoiceProviderConnection,
  type NewVoiceProviderConnection,
} from '../schema/voice-provider-connections.js'

export type {
  VoiceProviderConnection,
  NewVoiceProviderConnection,
} from '../schema/voice-provider-connections.js'

export function listVoiceProviderConnectionsForUser(
  db: Database,
  userId: string,
): VoiceProviderConnection[] {
  return db
    .select()
    .from(voiceProviderConnections)
    .where(eq(voiceProviderConnections.userId, userId))
    .orderBy(asc(voiceProviderConnections.createdAt))
    .all()
}

export function findVoiceProviderConnection(
  db: Database,
  input: { userId: string; provider: VoiceProviderId },
): VoiceProviderConnection | null {
  const [row] = db
    .select()
    .from(voiceProviderConnections)
    .where(
      and(
        eq(voiceProviderConnections.userId, input.userId),
        eq(voiceProviderConnections.provider, input.provider),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function insertVoiceProviderConnection(
  db: Database,
  row: NewVoiceProviderConnection,
): VoiceProviderConnection {
  const [inserted] = db.insert(voiceProviderConnections).values(row).returning().all()
  if (!inserted) throw new Error('insertVoiceProviderConnection: no row returned')
  return inserted
}

export function updateVoiceProviderConnection(
  db: Database,
  id: string,
  patch: Partial<NewVoiceProviderConnection>,
): VoiceProviderConnection {
  const [updated] = db
    .update(voiceProviderConnections)
    .set(patch)
    .where(eq(voiceProviderConnections.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateVoiceProviderConnection: no row for ${id}`)
  return updated
}

export function hardDeleteVoiceProviderConnection(db: Database, id: string): void {
  db.delete(voiceProviderConnections).where(eq(voiceProviderConnections.id, id)).run()
}

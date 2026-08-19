// The `checkpoint` tool's response contract: it records the pending
// checkpoint on the turn's OWN identity (the compose-time primary id — never
// model input) — durably, on that identity's row — and tells the model to end
// the turn; a plain conversation (no continuing identity) is told plainly it
// cannot checkpoint; an identity that no longer exists is answered honestly.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { insertPrimarySession } from '../repositories/index.js'
import { peekPendingCheckpoint } from '../continuity/pending-checkpoints.js'
import { buildCheckpointResponse } from './checkpoint-tool.js'

function seedPrimary(db: Database): string {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: null,
    scope: 'global',
    currentSdkSessionId: null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }).id
}

describe('checkpoint tool', () => {
  it('marks the pending checkpoint on the turn identity and asks the model to end the turn', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      const response = buildCheckpointResponse(
        db,
        { primarySessionId: primary },
        { nextStep: '  wire the DM stream, then run the gate  ' },
      )
      expect(response.isError).toBeUndefined()
      expect(response.content[0]!.text).toContain('Checkpoint noted: "wire the DM stream, then run the gate"')
      expect(response.content[0]!.text).toContain('END this turn')
      // Recorded under exactly this identity, trimmed.
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('wire the DM stream, then run the gate')
    })
  })

  it('a plain conversation (no continuing identity) cannot checkpoint — says so, records nothing', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      const response = buildCheckpointResponse(db, {}, { nextStep: 'anything' })
      expect(response.isError).toBe(true)
      expect(response.content[0]!.text).toContain('no continuing identity')
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
    })
  })

  it('an empty next step is an error, not a checkpoint', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      const response = buildCheckpointResponse(db, { primarySessionId: primary }, { nextStep: '   ' })
      expect(response.isError).toBe(true)
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
    })
  })

  it('caps a runaway next step at the documented length', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimary(db)
      buildCheckpointResponse(db, { primarySessionId: primary }, { nextStep: 'x'.repeat(2_000) })
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toHaveLength(600)
    })
  })

  it('an identity that no longer exists cannot be marked — the register throws, the tool answers with the error', async () => {
    await withTestDatabase((db) => {
      expect(() => buildCheckpointResponse(db, { primarySessionId: 'gone' }, { nextStep: 'x' })).toThrow(
        /primary session/,
      )
    })
  })
})

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
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import { insertPrimarySession } from '../repositories/index.js'
import { markPendingCheckpoint, peekPendingCheckpoint } from '../continuity/pending-checkpoints.js'
import { composeDroppedCheckpointNote } from '../continuity/drop-pending-checkpoint.js'
import { buildCheckpointResponse } from './checkpoint-tool.js'

// The tool stamps its write with the real clock, so every boundary here is
// stated relative to it — a fixed literal would race the calendar.
//
// A turn whose own writes land after it began.
const THIS_TURN_STARTED_AT = new Date(Date.now() - 60_000)
// The supersession pair. BOTH sit AFTER this process came up — deliberately:
// that is the case a process-start boundary could not see (a marker-less turn
// overwriting a leftover written earlier in the same process, in silence).
const LEFTOVER_STAMPED_AT = new Date(Date.now() + 1_000)
const LATER_TURN_STARTED_AT = new Date(Date.now() + 60_000)

function seedPrimary(db: Database, options: { withHead?: boolean } = {}): {
  primaryId: string
  headId: string | null
} {
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
  let headId: string | null = null
  if (options.withHead === true) {
    headId = `sdk-${randomUUID()}`
    insertChatSession(
      db,
      buildNewChatSessionRow({
        sessionId: headId,
        userId: user.id,
        workspaceId: null,
        providerId: 'claude',
        startedAt: now,
        title: 'Global brain',
        scope: 'global',
        visibility: 'hidden',
      }),
    )
  }
  const primary = insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: null,
    scope: 'global',
    currentSdkSessionId: headId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  return { primaryId: primary.id, headId }
}

function seedPrimaryId(db: Database): string {
  return seedPrimary(db).primaryId
}

describe('checkpoint tool', () => {
  it('marks the pending checkpoint on the turn identity and asks the model to end the turn', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimaryId(db)
      const response = buildCheckpointResponse(
        db,
        { primarySessionId: primary, turnStartedAt: THIS_TURN_STARTED_AT },
        { nextStep: '  wire the DM stream, then run the gate  ' },
      )
      expect(response.isError).toBeUndefined()
      expect(response.content[0]!.text).toContain('Checkpoint noted: "wire the DM stream, then run the gate"')
      expect(response.content[0]!.text).toContain('END this turn')
      // Audit r2 R2-N: the answer used to promise an automatic continuation on
      // every surface — it now says what each one actually does.
      expect(response.content[0]!.text).toContain('auto-continues')
      expect(response.content[0]!.text).toContain('elsewhere')
      // Recorded under exactly this identity, trimmed.
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toBe('wire the DM stream, then run the gate')
    })
  })

  it('a plain conversation (no continuing identity) cannot checkpoint — says so, records nothing', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimaryId(db)
      const response = buildCheckpointResponse(
        db,
        { turnStartedAt: THIS_TURN_STARTED_AT },
        { nextStep: 'anything' },
      )
      expect(response.isError).toBe(true)
      expect(response.content[0]!.text).toContain('no continuing identity')
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
    })
  })

  it('an empty next step is an error, not a checkpoint', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimaryId(db)
      const response = buildCheckpointResponse(
        db,
        { primarySessionId: primary, turnStartedAt: THIS_TURN_STARTED_AT },
        { nextStep: '   ' },
      )
      expect(response.isError).toBe(true)
      expect(peekPendingCheckpoint(db, primary)).toBeNull()
    })
  })

  it('caps a runaway next step at the documented length', async () => {
    await withTestDatabase((db) => {
      const primary = seedPrimaryId(db)
      buildCheckpointResponse(
        db,
        { primarySessionId: primary, turnStartedAt: THIS_TURN_STARTED_AT },
        { nextStep: 'x'.repeat(2_000) },
      )
      expect(peekPendingCheckpoint(db, primary)?.nextStep).toHaveLength(600)
    })
  })

  it('an identity that no longer exists cannot be marked — the register throws, the tool answers with the error', async () => {
    await withTestDatabase((db) => {
      expect(() =>
        buildCheckpointResponse(
          db,
          { primarySessionId: 'gone', turnStartedAt: THIS_TURN_STARTED_AT },
          { nextStep: 'x' },
        ),
      ).toThrow(/primary session/)
    })
  })

  // The boundary is the TURN's start, not the process's (audit r2 R2-H(b)
  // follow-up): a marker-less turn — a workspace schedule fire, any
  // `autoContinue: false` turn — never sees a step left earlier in the SAME
  // process, so overwriting it is a loss and must be said out loud.
  it('supersedes a leftover from an EARLIER turn of this same process — out loud', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedPrimary(db, { withHead: true })
      markPendingCheckpoint(db, primaryId, 'the earlier turn’s step', {
        now: () => LEFTOVER_STAMPED_AT,
      })

      buildCheckpointResponse(
        db,
        { primarySessionId: primaryId, turnStartedAt: LATER_TURN_STARTED_AT },
        { nextStep: 'this turn’s step' },
      )

      expect(listRecentChatMessagesForSession(db, headId!, 20).map((m) => m.body)).toEqual([
        composeDroppedCheckpointNote('the earlier turn’s step', 'superseded'),
      ])
      expect(peekPendingCheckpoint(db, primaryId)?.nextStep).toBe('this turn’s step')
    })
  })

  it('a SAME-TURN re-checkpoint stays silent — a model refining its own next step is not news', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedPrimary(db, { withHead: true })
      const scope = { primarySessionId: primaryId, turnStartedAt: THIS_TURN_STARTED_AT }

      buildCheckpointResponse(db, scope, { nextStep: 'first take' })
      buildCheckpointResponse(db, scope, { nextStep: 'second take' })

      expect(listRecentChatMessagesForSession(db, headId!, 20)).toEqual([])
      expect(peekPendingCheckpoint(db, primaryId)?.nextStep).toBe('second take')
    })
  })
})

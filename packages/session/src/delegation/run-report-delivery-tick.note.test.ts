// The GLOBAL-NOTE delivery (voice-session arc) — real SQLite, end-to-end
// through the tick: a both-null 'note' row (the `to:"global"` send) runs a
// notify turn on the GLOBAL conversation under the NOTE steer, with the
// enqueue-time marker-prefixed body passed VERBATIM (the note marker was
// composed at enqueue — the delivery must never double-mark), attributed as
// the sender. Targeted notes keep the task rail — untouched by this file.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import {
  enqueueNoteDelivery,
  findDelegationJobById,
  claimNextPendingDelegationJob,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
} from '@vynel/orchestration'
import { composeNoteMessageMarker } from '@vynel/contracts/chat/report-message-marker'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { NOTE_DELIVERY_INSTRUCTIONS } from './routed-turn-provider-input.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function enqueueGlobalNote(db: Parameters<typeof enqueueNoteDelivery>[0], userId: string): string {
  const noteBody = `${composeNoteMessageMarker('Voice')}\n\nThe user asked me to remind you about the deploy window.`
  return enqueueNoteDelivery(db, {
    userId,
    senderSessionId: 'voice-seg-1',
    senderLabel: 'Voice',
    target: { kind: 'global-root' },
    noteBody,
  })
}

describe('global-note delivery (to:"global", kind note)', () => {
  it('runs the notify turn on the GLOBAL conversation under the NOTE steer, body verbatim, attributed as the sender', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const jobId = enqueueGlobalNote(db, user.id)

      const row = findDelegationJobById(db, jobId)
      expect(row?.jobKind).toBe('note')
      expect(row?.workspaceId).toBeNull()
      expect(row?.targetPrimarySessionId).toBeNull()

      const notifyCalls: {
        reportBody: string
        sourceLabel: string
        sourceKind: string | undefined
        steerInstructions: string | undefined
      }[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async (input) => {
          notifyCalls.push({
            reportBody: input.reportBody,
            sourceLabel: input.sourceLabel,
            sourceKind: input.sourceKind,
            steerInstructions: input.steerInstructions,
          })
          return { sessionId: 'g-root-n1', resultText: 'noted' }
        },
      })

      expect(processed).toBe(true)
      expect(notifyCalls).toHaveLength(1)
      const call = notifyCalls[0]!
      // The enqueue-time marker IS the body's head — delivered verbatim, no
      // second marker layered on top.
      expect(call.reportBody.startsWith('[Note from Voice')).toBe(true)
      expect(call.reportBody).toContain('deploy window')
      expect(call.reportBody.match(/\[Note from/g)).toHaveLength(1)
      expect(call.sourceLabel).toBe('Voice')
      expect(call.sourceKind).toBe('workspace-manager')
      expect(call.steerInstructions).toBe(NOTE_DELIVERY_INSTRUCTIONS)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
    })
  })

  it('respects the GLOBAL single-writer key: a both-null note stays PENDING while the key is held', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      enqueueGlobalNote(db, user.id)

      // Key held (another global delivery running) → the note must wait…
      expect(
        claimNextPendingDelegationJob(db, new Date(), {
          excludeTargetKeys: [GLOBAL_ROOT_DELIVERY_TARGET_KEY],
        }),
      ).toBeNull()
      // …and claim normally once the key frees.
      expect(claimNextPendingDelegationJob(db, new Date())).not.toBeNull()
    })
  })
})

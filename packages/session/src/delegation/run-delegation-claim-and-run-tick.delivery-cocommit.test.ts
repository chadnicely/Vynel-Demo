// The completion co-commit's FAILURE path (session-comms review fold): a throw
// while enqueueing the report delivery must roll the whole write back and fall
// open to completing the job ALONE — never a COMPLETED turn flipped to failed,
// never a surfaced-but-undelivered report (unsurfaced = the root's next-turn
// catch-up still carries it). Lives in its OWN file because it partially mocks
// `@vynel/orchestration` (the throwing enqueue) — the main tick test runs the
// real module.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'

vi.mock('@vynel/orchestration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vynel/orchestration')>()
  return {
    ...actual,
    enqueueReportDelivery: vi.fn(() => {
      throw new Error('the delivery enqueue exploded')
    }),
  }
})

import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

describe('runDelegationClaimAndRunTick — delivery co-commit failure', () => {
  it('a throwing delivery enqueue leaves the job COMPLETED + UNSURFACED, with no delivery row behind it', async () => {
    await withTestDatabase(async (db) => {
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
      const workspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'personal',
        path: `/tmp/vynel/${randomUUID()}`,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'g-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
      })

      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-cocommit',
          resultText: 'Acme has 3 docs; all current.',
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(processed).toBe(true)

      // The FINISHED turn stayed completed — the transaction rolled back and
      // the fallback completed the job alone…
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultText).toBe('Acme has 3 docs; all current.')
      // …UNSURFACED, so the catch-up net still carries the report.
      expect(job?.surfacedToRootAt).toBeNull()

      // No delivery row survived the rollback — the queue is empty.
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'never' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
        }),
      ).toBe(false)
    })
  })
})

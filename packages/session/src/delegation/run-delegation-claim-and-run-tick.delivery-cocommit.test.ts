// The completion co-commit's FAILURE path: a throw inside the co-commit
// (complete + mark-surfaced, one transaction) must roll back and fall open to
// completing the job ALONE — never a COMPLETED turn flipped to failed. Lives
// in its OWN file because it partially mocks `@vynel/orchestration` (the
// throwing mark) — the main tick test runs the real module.
//
// test: recast for the no-harvest pipeline (Chad, locked 2026-07-27) — the
// co-commit used to be complete + enqueue-report-delivery; the harvest is
// gone, so the failure under test is now the surfaced mark throwing.

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
    markDelegationsSurfacedToRoot: vi.fn(() => {
      throw new Error('the surfaced mark exploded')
    }),
  }
})

import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

describe('runDelegationClaimAndRunTick — completion co-commit failure', () => {
  it('a throwing surfaced-mark leaves the job COMPLETED (alone, unsurfaced) — never failed', async () => {
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
      // the fallback completed the job alone. The mark is retried standalone,
      // but this mock ALWAYS throws, so the row stays unsurfaced — the one
      // ACCEPTED terminal window where the root's catch-up may echo the reply
      // (awareness over policy, logged loud; a transient transaction failure
      // recovers via the retry instead).
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultText).toBe('Acme has 3 docs; all current.')
      expect(job?.surfacedToRootAt).toBeNull()

      // test: correct expectation for the channel report protocol (Kafi
      // 2026-08-22) — was "NO delivery row exists either way". The auto-report
      // lives PAST the completion write, so a co-commit failure must not eat
      // it: this turn ended without calling send_message, and its requester
      // still has to hear the result. One delivery is queued, and it settles
      // (no injected global runner here, so it fails terminally rather than
      // running a notify turn — either way the queue drains, never stuck).
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'never' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
        }),
      ).toBe(true)
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

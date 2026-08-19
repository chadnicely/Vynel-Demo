// The hard-cap + lease invariants of the delegation tick (session-hardening
// A1/A2/A3b) — the audit's L1 repro shape turned into regression tests: a
// provider whose turn yields `session-started` and then never ends UNTIL it is
// interrupted, a tiny cap, and the pool's exclusion snapshot replayed the way
// the service replays it. Real SQLite + the fake provider, no live SDK.
//
// What "the lock lifetime is the whole run" means, testably: the tick's
// promise IS the pool's release point (`delegation-service` frees the target
// key in the tick's `.finally`), so a tick that settles before its turn does
// is a lock released under a live writer. These tests pin that it never does.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import { createAgent } from '@vynel/agents'
import {
  claimNextPendingDelegationJob,
  enqueueAgentRun,
  enqueueReportDelivery,
  enqueueWorkspaceDelegation,
  findDelegationJobById,
  requeueDelegationJob,
} from '@vynel/orchestration'
import {
  getOrCreateContinuingSession,
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import { DELEGATION_MAX_ATTEMPTS } from './classify-turn-failure.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    managerName: 'Mark',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

async function setUpGlobalRoot(db: Database, userId: string): Promise<string> {
  const globalPrimary = await getOrCreatePrimarySession(db, { userId })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: 'global-sdk-1',
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
  linkPrimarySessionToSdkSession(db, {
    primarySessionId: globalPrimary.id,
    userId,
    sdkSessionId: 'global-sdk-1',
  })
  return 'global-sdk-1'
}

/** A turn that starts and then runs FOREVER — until `interruptChatSession`
 *  lands, after which (optionally after `settleDelayMs`) it yields
 *  `session-interrupted` and ends. `started` counts live turns. */
class NeverEndingUntilInterruptedProvider extends FakeAiAgentProvider {
  started = 0
  private readonly interruptArrived = new Map<string, () => void>()
  constructor(private readonly settleDelayMs = 0) {
    super()
  }
  override startChatSession(input: StartChatSessionInput): AsyncIterable<NormalizedSessionEvent> {
    this.started += 1
    const sessionId = `never-ending-${this.started}`
    const arrival = new Promise<void>((resolve) => this.interruptArrived.set(sessionId, resolve))
    const settleDelayMs = this.settleDelayMs
    async function* events(): AsyncIterable<NormalizedSessionEvent> {
      yield {
        kind: 'session-started',
        sessionId,
        resumedFromExisting: input.resumeSessionId !== undefined,
        startedAt: new Date(),
      }
      await arrival
      if (settleDelayMs > 0) await wait(settleDelayMs)
      yield { kind: 'session-interrupted', sessionId, interruptedAt: new Date() }
    }
    return events()
  }
  override async interruptChatSession(sessionId: string): Promise<void> {
    await super.interruptChatSession(sessionId)
    this.interruptArrived.get(sessionId)?.()
  }
}

type WorkspaceRow = { id: string; path: string; name: string }

function enqueueTask(
  db: Database,
  userId: string,
  workspace: WorkspaceRow,
  parentSessionId: string,
  taskText: string,
) {
  return enqueueWorkspaceDelegation(db, {
    userId,
    parentSessionId,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText,
  })
}

describe('runDelegationClaimAndRunTick — the hard cap holds the lock for the WHOLE run', () => {
  it('two jobs on one target never run concurrently: the capped first run keeps its key (the tick stays pending) until its turn settled; only then does the second start', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobA = enqueueTask(db, user.id, workspace, globalSessionId, 'the long task')
      const jobB = enqueueTask(db, user.id, workspace, globalSessionId, 'the follow-up task')

      // The turn keeps running 150ms AFTER the interrupt lands — the window
      // in which the old shape had already returned and freed the key.
      const provider = new NeverEndingUntilInterruptedProvider(150)
      const deps = { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() }
      let tickASettled = false
      const tickA = runDelegationClaimAndRunTick(db, { ...deps, hardCapMs: 30 }).then((r) => {
        tickASettled = true
        return r
      })
      await wait(10)
      expect(provider.started).toBe(1)

      // The pool's next poll: the service snapshots busy keys (A holds the
      // workspace) — the claim must skip B while A's tick is pending.
      const busyKeys = new Set([workspace.id])
      expect(await runDelegationClaimAndRunTick(db, { ...deps, excludeTargetKeys: busyKeys })).toBe(false)

      // Past the cap: the interrupt landed, but the turn is still winding
      // down — the tick MUST still be pending (the key still held).
      await wait(80)
      expect(provider.interruptedSessionIds).toEqual(['never-ending-1'])
      expect(tickASettled).toBe(false)
      expect(findDelegationJobById(db, jobA)!.status).toBe('claimed')
      expect(await runDelegationClaimAndRunTick(db, { ...deps, excludeTargetKeys: busyKeys })).toBe(false)
      expect(provider.started).toBe(1)

      expect(await tickA).toBe(true)
      const capped = findDelegationJobById(db, jobA)!
      expect(capped.status).toBe('failed')
      expect(capped.errorMessage).toBe('exceeded the 30ms cap')
      // The honest failure delivery for the requester (settle's give-up push).
      expect(capped.surfacedToRootAt).not.toBeNull()

      // Only now (key released by the service on settle) does B run — and it
      // resumes the workspace root as the ONLY live writer.
      expect(await runDelegationClaimAndRunTick(db, { ...deps, hardCapMs: 30 })).toBe(true)
      expect(provider.started).toBe(2)
      expect(findDelegationJobById(db, jobB)!.status).toBe('failed')
    })
  })

  it('a capped task settles through the give-up push, never a requeue — one hour on the lock is not a retry', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobId = enqueueTask(db, user.id, workspace, globalSessionId, 'the long task')

      const provider = new NeverEndingUntilInterruptedProvider()
      await runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 20,
      })
      const job = findDelegationJobById(db, jobId)!
      expect(job.status).toBe('failed')
      expect(job.errorMessage).toBe('exceeded the 20ms cap')
      expect(job.attemptCount ?? 0).toBe(0)
      // The failure delivery is queued for the requester (the global root).
      const push = claimNextPendingDelegationJob(db, new Date(Date.now() + 60 * 60 * 1000))
      expect(push?.jobKind).toBe('report-delivery')
      expect(push?.taskText).toContain('exceeded the 20ms cap')
    })
  })

  it('a user Stop that lands during the capped wind-down still reads "stopped by the user"', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobId = enqueueTask(db, user.id, workspace, globalSessionId, 'the long task')
      const partialSessionId = findDelegationJobById(db, jobId)!.partialSessionId!

      const cancelRegistry = new DelegationCancelRegistry()
      const provider = new NeverEndingUntilInterruptedProvider(60)
      const tick = runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        cancelRegistry,
        hardCapMs: 20,
      })
      await wait(40)
      cancelRegistry.requestCancel(partialSessionId)
      await tick
      expect(findDelegationJobById(db, jobId)!.errorMessage).toBe('stopped by the user')
    })
  })

  it('the cap is SUSPENDED while an approval is parked — a slow human decision never caps the job', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobId = enqueueTask(db, user.id, workspace, globalSessionId, 'write the file')

      // The fake parks on `approval-requested` until someone decides.
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-parked',
        resultText: 'Written.',
        approvalToolName: 'Write',
      })
      const tick = runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 20,
      })
      await wait(120) // six caps' worth of human deciding time
      expect(provider.interruptedSessionIds).toEqual([])
      expect(findDelegationJobById(db, jobId)!.status).toBe('claimed')

      const card = listPendingApprovalsForUser(db, user.id)[0]!
      await provider.respondToApprovalRequest(card.providerApprovalId, { kind: 'approved' })
      await tick
      expect(findDelegationJobById(db, jobId)!.status).toBe('completed')
    })
  })

  it('a live run heartbeats its lease forward until it settles', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobId = enqueueTask(db, user.id, workspace, globalSessionId, 'the long task')

      const provider = new NeverEndingUntilInterruptedProvider()
      const tick = runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 200,
        leaseMs: 1_000,
        heartbeatMs: 20,
      })
      await wait(30)
      const claimed = findDelegationJobById(db, jobId)!
      expect(claimed.status).toBe('claimed')
      expect(claimed.leaseExpiresAt).not.toBeNull()
      const firstLease = claimed.leaseExpiresAt!.getTime()
      await wait(80)
      const beaten = findDelegationJobById(db, jobId)!
      expect(beaten.heartbeatAt!.getTime()).toBeGreaterThan(claimed.claimedAt!.getTime())
      expect(beaten.leaseExpiresAt!.getTime()).toBeGreaterThan(firstLease)
      await tick
      expect(findDelegationJobById(db, jobId)!.status).toBe('failed')
    })
  })
})

describe('runReportDeliveryJob — a capped delivery is RECOVERABLE', () => {
  function enqueueWorkspaceDelivery(db: Database, userId: string, workspace: WorkspaceRow) {
    return enqueueReportDelivery(db, {
      userId,
      reporterSessionId: 'child-sdk-1',
      reporterLabel: 'Research session',
      reportBody: 'The findings: three items.',
      requester: { kind: 'workspace-primary', workspaceId: workspace.id, workspacePath: workspace.path },
    })
  }

  it('requeues with backoff on the first cap (attempts remain) — the message body is the only copy', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const deliveryId = enqueueWorkspaceDelivery(db, user.id, workspace)

      await runDelegationClaimAndRunTick(db, {
        provider: new NeverEndingUntilInterruptedProvider(),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 20,
      })
      const row = findDelegationJobById(db, deliveryId)!
      expect(row.status).toBe('pending')
      expect(row.attemptCount).toBe(1)
      expect(row.nextAttemptAt).not.toBeNull()
      expect(row.errorMessage).toBe('exceeded the 20ms cap')
    })
  })

  it('fails terminally when capped on its LAST attempt', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const deliveryId = enqueueWorkspaceDelivery(db, user.id, workspace)
      // Already at the ceiling minus one: this attempt is the last.
      requeueDelegationJob(db, deliveryId, {
        errorMessage: 'earlier cap',
        errorCode: null,
        attemptCount: DELEGATION_MAX_ATTEMPTS - 1,
        nextAttemptAt: new Date(0),
      })

      await runDelegationClaimAndRunTick(db, {
        provider: new NeverEndingUntilInterruptedProvider(),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 20,
      })
      const row = findDelegationJobById(db, deliveryId)!
      expect(row.status).toBe('failed')
      expect(row.errorMessage).toBe('exceeded the 20ms cap')
    })
  })
})

describe('runAgentRunJob — the colleague turn under the same cap', () => {
  it('a capped colleague run fails through the give-up push (never a requeue), the row keeps the honest cap message', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Reviews code.',
        prompt: 'You review code carefully.',
        source: 'user',
        trustTier: 'community',
      })
      const colleague = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'agent',
        workspaceId: workspace.id,
        scopeRef: 'code-reviewer',
      })
      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'ws-primary-sdk',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer look at the latest diff',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        targetPrimarySessionId: colleague.id,
        requesterWorkspaceId: workspace.id,
      })

      const provider = new NeverEndingUntilInterruptedProvider()
      await runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 20,
      })
      expect(provider.interruptedSessionIds).toEqual(['never-ending-1'])
      const job = findDelegationJobById(db, jobId)!
      expect(job.status).toBe('failed')
      expect(job.errorMessage).toBe('exceeded the 20ms cap')
      const push = claimNextPendingDelegationJob(db, new Date(Date.now() + 60 * 60 * 1000))
      expect(push?.jobKind).toBe('report-delivery')
      expect(push?.taskText).toContain('mention the agent again')
    })
  })
})

describe('runReportDeliveryJob — the GLOBAL branch marks its wait gate (A3a)', () => {
  it('a global notify turn parked on an approval longer than the cap still completes — the injected runner drives the gate', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await setUpGlobalRoot(db, user.id)
      const deliveryId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Research session',
        reportBody: 'The findings: three items.',
        requester: { kind: 'global-root' },
      })

      const provider = new FakeAiAgentProvider()
      await runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        hardCapMs: 20,
        // The apps runner's contract, replayed: a card parks the gate, the
        // human takes far longer than the cap, the decision resumes it.
        runGlobalRootReportTurn: async (input) => {
          input.onSessionResolved?.('global-notify-sdk')
          input.waitGate?.markParked()
          await wait(100)
          input.waitGate?.markResolved()
          return { sessionId: 'global-notify-sdk', resultText: 'Absorbed the report.' }
        },
      })
      expect(provider.interruptedSessionIds).toEqual([])
      const row = findDelegationJobById(db, deliveryId)!
      expect(row.status).toBe('completed')
    })
  })
})

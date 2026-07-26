// Integration test for `runDelegationClaimAndRunTick` (brain-tree Chapter 1, async core) —
// the deterministic end-to-end of the async loop with a fake provider: enqueue → claim →
// run the routed turn → complete → enqueue the report-delivery notify job → a later tick
// runs the NOTIFY turn on the creator (session-comms, the revert flow). Real SQLite, no
// live SDK. The old pushed-row expectations were RECAST deliberately: a report now lands
// as the notify turn's attributed INBOUND message (workspace creators, end-to-end here)
// or through the injected global runner seam (global creators, asserted via the mock).

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { composeReportMessageMarker } from '@vynel/contracts/chat/report-message-marker'
import { withTestDatabase } from '@vynel/testing'
import { listPendingApprovalsForUser } from '@vynel/approvals'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  listChatMessagesForSession,
  listChatMessagesByPartialSessionId,
  insertChatSession,
} from '@vynel/chat/repositories'
import {
  enqueueWorkspaceDelegation,
  enqueueSessionDelegation,
  enqueueReportDelivery,
  findDelegationJobById,
  findDelegationJobByPartialSessionId,
  GLOBAL_ROOT_DELIVERY_TARGET_KEY,
} from '@vynel/orchestration'
import { createSpawnedSession } from '../spawned/index.js'
import { insertChannel, listOutboundMessagesForChannel } from '@vynel/channels/test-support'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { buildNewChatSessionRow } from '@vynel/chat'
import {
  FakeAiAgentProvider,
  type SummarizeReportCall,
} from '../runtime/test-support/fake-ai-agent-provider.js'
import { resolveDelegationTrace } from './resolve-delegation-trace.js'
import { DelegationCancelRegistry } from './delegation-cancel-registry.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'

// The tick only calls warn/error/info — a no-op stub satisfies pino's Logger (the
// FakeAiAgentProvider uses the same `as unknown as` test-stub idiom).
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

// What the notify turn's inbound looks like since 2026-07-27: the per-message
// attribution marker rides ON the delivered text (the model must never mistake
// a report for user input — Chad's smoke caught exactly that misread).
function markedReport(sourceLabel: string, body: string): string {
  return `${composeReportMessageMarker(sourceLabel)}\n\n${body}`
}

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
    managerName: 'Mark', // brain-tree Ch5 — attributions read "Mark · Acme"
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

// A live global root (primary_sessions + its chat_sessions segment + the link) so a pushed
// report has an FK target. Returns the global root's sdk session id.
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

// A provider whose turn throws — exercises the failure path (delegateToWorkspaceRoot
// rejects → routeRequest returns `failed` → the job is recorded failed, never stuck claimed).
class ThrowingTurnProvider extends FakeAiAgentProvider {
  override startChatSession(): never {
    throw new Error('the workspace turn exploded')
  }
}

// The captured input of the injected global notify runner (session-comms).
type GlobalReportTurnCall = {
  userId: string
  reportBody: string
  sourceLabel: string
  partialSessionId?: string
}

// A stub global notify runner: records its calls, "absorbs" the report.
function makeGlobalReportRunner(calls: GlobalReportTurnCall[] = []) {
  return async (input: GlobalReportTurnCall) => {
    calls.push(input)
    return { sessionId: 'global-notify-sdk', resultText: 'Absorbed the report.' }
  }
}

// Drain any pending report-delivery jobs a completed TASK tick enqueued —
// multi-step tests re-tick for their NEXT task, and FIFO would hand them the
// older delivery first. Workspace-target deliveries run a real (fake-provider)
// notify turn; global ones hit the stub runner.
async function drainPendingReportDeliveries(db: Database): Promise<void> {
  let processed = true
  while (processed) {
    processed = await runDelegationClaimAndRunTick(db, {
      provider: new FakeAiAgentProvider({
        seededSessionId: `drain-${randomUUID()}`,
        resultText: 'absorbed',
      }),
      logger: silentLogger,
      activityFeed: new SessionActivityFeed(),
      runGlobalRootReportTurn: makeGlobalReportRunner(),
    })
  }
}

describe('runDelegationClaimAndRunTick', () => {
  it('runs the routed turn under the job’s permission mode (surface-up step 1), defaulting to bypass', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'tidy the notes',
        permissionMode: 'ask',
      })
      const askInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-ask',
          resultText: 'ok',
          startChatSessionInputs: askInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(askInputs[0]!.permissionMode).toBe('ask')
      await drainPendingReportDeliveries(db)

      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'read the docs',
      })
      const defaultInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-default',
          resultText: 'ok',
          startChatSessionInputs: defaultInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(defaultInputs[0]!.permissionMode).toBe('bypass-with-behavior-gate')
    })
  })

  it('threads the job’s model + thinking effort into the provider turn for BOTH target kinds; omitted = absent', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      // WORKSPACE target: the enqueue-time picks reach startChatSession.
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'routine tidy-up',
        model: 'claude-haiku-4-5',
        thinkingEffort: 'low',
      })
      const workspaceInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-picks',
          resultText: 'ok',
          startChatSessionInputs: workspaceInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(workspaceInputs[0]!.model).toBe('claude-haiku-4-5')
      expect(workspaceInputs[0]!.thinkingEffort).toBe('low')
      await drainPendingReportDeliveries(db)

      // SESSION target: same threading through delegateToSpawnedSession.
      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-picks' }),
        { userId: user.id, name: 'S', purpose: 'p', workspacePath: '/tmp/x' },
      )
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: '/tmp/x',
        taskText: 'hard analysis',
        model: 'claude-sonnet-4-6',
        thinkingEffort: 'max',
      })
      const sessionInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: created.sessionId,
          resultText: 'ok',
          startChatSessionInputs: sessionInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(sessionInputs[0]!.model).toBe('claude-sonnet-4-6')
      expect(sessionInputs[0]!.thinkingEffort).toBe('max')
      await drainPendingReportDeliveries(db)

      // No picks on the job → the keys are ABSENT from the provider input
      // (pinned: the SDK defaults stay in charge, exactOptionalPropertyTypes).
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'default run',
      })
      const defaultInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-picks-default',
          resultText: 'ok',
          startChatSessionInputs: defaultInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(defaultInputs[0]!).not.toHaveProperty('model')
      expect(defaultInputs[0]!).not.toHaveProperty('thinkingEffort')
    })
  })

  it('composes the background MCP attachment per target grounding (workspace job → its workspace; workspace-grounded session → its ground; global-grounded session → none)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const attachment = {
        mcpServers: { vynel: { name: 'vynel' } },
        allowedMcpToolPatterns: ['mcp__vynel__*'],
        deniedMcpToolPatterns: [],
        mutatingToolNames: [],
        askModeApprovalToolNames: [],
        systemPromptAppend: '',
      }
      const composeWorkspaceMcpServers = vi.fn(() => attachment)

      // WORKSPACE target: composed with the JOB's workspace, attachment reaches
      // the provider turn — a bare routed turn strips the resumed session's
      // deferred tools ("server disconnected", the 2026-07-21 bug).
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'tidy the notes',
      })
      const workspaceInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-mcp',
          resultText: 'ok',
          startChatSessionInputs: workspaceInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        composeWorkspaceMcpServers,
      })
      // target 'workspace-root' → the api edge composes the INTERACTIVE set
      // (session-routing trio included — the 2026-07-21 re-decision).
      // threadId rides along so a hop THIS turn makes continues the chain
      // instead of starting a fresh one (expect.any: the key is minted at
      // enqueue, so the test can't know it up front).
      expect(composeWorkspaceMcpServers).toHaveBeenCalledWith({
        db,
        userId: user.id,
        workspaceId: workspace.id,
        target: 'workspace-root',
        threadId: expect.any(String),
        jobId: expect.any(String),
      })
      expect(workspaceInputs[0]!.mcpServers).toEqual({ vynel: { name: 'vynel' } })
      expect(workspaceInputs[0]!.allowedMcpToolPatterns).toEqual(['mcp__vynel__*'])
      await drainPendingReportDeliveries(db)

      // WORKSPACE-GROUNDED session target (Slice ④b): composed with the spawned
      // primary's OWN workspaceId — the session works in its ground's toolset.
      composeWorkspaceMcpServers.mockClear()
      const grounded = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-grounded' }),
        {
          userId: user.id,
          name: 'Grounded',
          purpose: 'p',
          workspacePath: workspace.path,
          workspaceId: workspace.id,
        },
      )
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        targetPrimarySessionId: grounded.primarySessionId,
        runCwdPath: workspace.path,
        taskText: 'grounded task',
      })
      const groundedInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: grounded.sessionId,
          resultText: 'ok',
          startChatSessionInputs: groundedInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        composeWorkspaceMcpServers,
      })
      // The spawned primary id rides along (session-comms): the api edge stamps
      // the caller-identity header from it so report_to_requester resolves the
      // SESSION, not just its grounding workspace.
      expect(composeWorkspaceMcpServers).toHaveBeenCalledWith({
        db,
        userId: user.id,
        workspaceId: workspace.id,
        target: 'spawned-session',
        targetPrimarySessionId: grounded.primarySessionId,
        threadId: expect.any(String),
        jobId: expect.any(String),
      })
      expect(groundedInputs[0]!.mcpServers).toEqual({ vynel: { name: 'vynel' } })
      await drainPendingReportDeliveries(db)

      // SPEC CHANGE (2026-07-26, Chad): a GLOBAL-grounded session target now
      // composes too, with workspaceId NULL — it inherits its parent's toolset,
      // and the parent of a global-grounded session is the global ROOT. It used
      // to get nothing at all, which meant it could not even report back.
      composeWorkspaceMcpServers.mockClear()
      const globalGrounded = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-global' }),
        { userId: user.id, name: 'Global', purpose: 'p', workspacePath: '/tmp/x' },
      )
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        targetPrimarySessionId: globalGrounded.primarySessionId,
        runCwdPath: '/tmp/x',
        taskText: 'global task',
      })
      const globalInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: globalGrounded.sessionId,
          resultText: 'ok',
          startChatSessionInputs: globalInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        composeWorkspaceMcpServers,
      })
      expect(composeWorkspaceMcpServers).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: null,
          target: 'spawned-session',
          targetPrimarySessionId: globalGrounded.primarySessionId,
        }),
      )
      expect(globalInputs[0]!).toHaveProperty('mcpServers')
    })
  })

  it('claims a pending job, runs it, completes it SURFACED — and enqueues NO delivery (reports travel only via send_message)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
      })

      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-new',
        resultText: 'Acme has 3 docs; all current.',
      })
      const processed = await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      expect(processed).toBe(true)

      // The job reached `completed` with the result text, and is marked
      // SURFACED: the notify turn is the awareness path now — without the
      // mark, the root's next-turn catch-up would inject the report twice.
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultText).toBe('Acme has 3 docs; all current.')
      expect(job?.surfacedToRootAt).not.toBeNull()

      // Brain-tree Chapter 2: the task's trace is now the task + the workspace
      // reply — the detached pushed report row is GONE (deliberately: the
      // report reaches the creator as the notify turn's inbound message,
      // keyed by the DELIVERY job's own trace).
      const traceKey = job?.partialSessionId
      expect(typeof traceKey).toBe('string')
      expect(listChatMessagesByPartialSessionId(db, traceKey!).map((m) => m.body)).toEqual([
        'summarize the docs',
        'Acme has 3 docs; all current.',
      ])
      const trace = resolveDelegationTrace(db, { userId: user.id, partialSessionId: traceKey! })
      expect(trace.entries.map((e) => [e.sourceKind, e.sourceLabel, e.body])).toEqual([
        ['global-root', null, 'summarize the docs'],
        ['workspace-manager', 'Mark · Acme', 'Acme has 3 docs; all current.'],
      ])

      // The workspace transcript got the attributed task + reply.
      expect(
        listChatMessagesForSession(db, 'ws-root-new').map((m) => [m.role, m.sourceKind, m.sourceLabel]),
      ).toEqual([
        ['user', 'global-root', null],
        ['assistant', 'workspace-manager', 'Mark · Acme'],
      ])

      // NOTHING was pushed onto the global transcript.
      expect(listChatMessagesForSession(db, globalSessionId)).toEqual([])

      // test: recast for the no-harvest pipeline (Chad, locked 2026-07-27) —
      // the chat reply is NEVER captured into a delivery; the queue is empty
      // (a second tick finds nothing) and the completed row is SURFACED so the
      // root's catch-up cannot re-inject the reply through the other door.
      // Reports reach a parent ONLY when the child calls send_message.
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'never' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
          runGlobalRootReportTurn: makeGlobalReportRunner(),
        }),
      ).toBe(false)
    })
  })

  it('returns false when the queue is empty', async () => {
    await withTestDatabase(async (db) => {
      const provider = new FakeAiAgentProvider({ seededSessionId: 'x', resultText: 'y' })
      expect(await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })).toBe(false)
    })
  })

  it('completes the job even when there is no global root to push to (push skipped)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // No global root set up — the push is skipped, the job still completes.

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-absent',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'check the logs',
      })

      const provider = new FakeAiAgentProvider({ seededSessionId: 'ws-root-2', resultText: 'all clear' })
      const processed = await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      expect(processed).toBe(true)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
      // The workspace transcript still received the exchange.
      expect(listChatMessagesForSession(db, 'ws-root-2')).toHaveLength(2)
    })
  })

  it('a user Stop mid-run fails the job "stopped by the user" and never pushes a partial report', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'a long task the user cancels',
      })
      const partialSessionId = findDelegationJobById(db, jobId)!.partialSessionId!

      // The stop route's two moves, replayed mid-stream: flag the run on the
      // registry, then the provider interrupt lands as `session-interrupted`.
      const cancelRegistry = new DelegationCancelRegistry()
      class InterruptedMidRunProvider extends FakeAiAgentProvider {
        override startChatSession(): AsyncIterable<NormalizedSessionEvent> {
          async function* events(): AsyncIterable<NormalizedSessionEvent> {
            yield {
              kind: 'session-started',
              sessionId: 'ws-root-stop',
              resumedFromExisting: false,
              startedAt: new Date(),
            }
            yield {
              kind: 'text-chunk',
              sessionId: 'ws-root-stop',
              messageId: 'm-stop-1',
              textDelta: 'partial work…',
              isFinalChunk: false,
            }
            cancelRegistry.requestCancel(partialSessionId) // the user hits Stop
            yield {
              kind: 'session-interrupted',
              sessionId: 'ws-root-stop',
              interruptedAt: new Date(),
            }
          }
          return events()
        }
      }

      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new InterruptedMidRunProvider(),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        cancelRegistry,
      })
      expect(processed).toBe(true)

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('failed')
      expect(job?.errorMessage).toBe('stopped by the user')

      // The partial text must NOT surface as a green report in the global thread.
      const globalMessages = listChatMessagesForSession(db, globalSessionId)
      expect(globalMessages.some((m) => m.body.includes('partial work'))).toBe(false)

      // The run deregistered — a later stop for the same key finds nothing.
      expect(cancelRegistry.requestCancel(partialSessionId).found).toBe(false)
    })
  })

  it('a flag-only Stop (no interrupt landed) still fails the job at terminal time', async () => {
    // The flag-only window: Stop arrives before the turn has a session id, so
    // no interrupt fires and the stream completes normally — the flag alone
    // must stop it (fail, suppress the report), as the route promised.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'stopped before the turn even started',
      })
      const partialSessionId = findDelegationJobById(db, jobId)!.partialSessionId!

      const cancelRegistry = new DelegationCancelRegistry()
      // The Stop lands the instant the run registers — before any session id.
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-outran',
        resultText: 'finished anyway',
      })
      const originalBegin = cancelRegistry.begin.bind(cancelRegistry)
      cancelRegistry.begin = (key) => {
        const handle = originalBegin(key)
        cancelRegistry.requestCancel(key)
        return handle
      }

      await runDelegationClaimAndRunTick(db, {
        provider,
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        cancelRegistry,
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('failed')
      expect(job?.errorMessage).toBe('stopped by the user')
      const globalMessages = listChatMessagesForSession(db, globalSessionId)
      expect(globalMessages.some((m) => m.body.includes('finished anyway'))).toBe(false)
    })
  })

  it('records the job as failed (never stuck claimed) when the workspace turn throws', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-x',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'cause a failure',
      })

      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new ThrowingTurnProvider(),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })

      // The job reached a terminal `failed` state — NOT stuck `claimed`.
      expect(processed).toBe(true)
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('failed')
      expect(job?.errorMessage).not.toBeNull()
    })
  })

  it('delivers the report back to the ORIGIN channel when a channel drove the delegation (Ch4)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const now = new Date()
      const channel = insertChannel(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bot',
        botCredentials: JSON.stringify({ botToken: 't' }),
        botMetadata: '{}',
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: null,
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
        origin: { channelId: channel.id, externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
      })

      const provider = new FakeAiAgentProvider({ seededSessionId: 'ws-root-ch', resultText: 'Acme has 3 docs.' })
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
      // The report closed the loop — delivered back to the origin channel + recipient.
      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        channelId: channel.id,
        externalRecipientId: 'tg-42',
        externalChatContextId: 'chat-7',
        messageBody: 'Acme has 3 docs.',
        payloadKind: 'chat-stream-final',
      })
    })
  })

  it('never distills or delivers without a driving channel — the full reply stays on the job + trace', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      const longReport = 'Finding: every doc is current and cross-linked. '.repeat(20)
      // The routed drain trims the streamed reply — what the tick (and the
      // distill) sees is the trimmed text; the persisted chunk keeps its raw form.
      const drainedReport = longReport.trim()
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'audit the docs',
      })

      const distillCalls: SummarizeReportCall[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-distill',
        resultText: longReport,
        reportReply: 'Done — all docs are current and cross-linked.',
        summarizeReportInputs: distillCalls,
      })
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      // test: recast for the no-harvest pipeline (Chad, locked 2026-07-27) —
      // the distill serves CHANNEL delivery only. No driving channel = nothing
      // to distill FOR (no model call) and nothing delivered; the full reply
      // stays on the job row + the workspace transcript (the trace truth).
      expect(distillCalls).toHaveLength(0)
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'unused' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
          runGlobalRootReportTurn: makeGlobalReportRunner(),
        }),
      ).toBe(false)
      expect(listChatMessagesForSession(db, globalSessionId)).toEqual([])
      expect(findDelegationJobById(db, jobId)?.resultText).toBe(drainedReport)
      // The workspace transcript keeps the full reply — the Watch drill-down's body.
      expect(
        listChatMessagesForSession(db, 'ws-root-distill').map((m) => m.body),
      ).toEqual(['audit the docs', longReport])
    })
  })

  // test: recast for the no-harvest pipeline (Chad, locked 2026-07-27) — the
  // distill fail-open now protects the CHANNEL delivery: a channel user must
  // never lose the answer to a broken distill.
  it('a channel delivery falls open to the FULL reply when the provider cannot distill', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const now = new Date()
      const channel = insertChannel(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bot',
        botCredentials: JSON.stringify({ botToken: 't' }),
        botMetadata: '{}',
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: null,
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })

      const longReport = 'Line of detailed findings the user still needs. '.repeat(20)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'audit the docs',
        origin: { channelId: channel.id, externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
      })

      // No reportReply configured → summarizeReport returns null (unsupported).
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-noreply',
        resultText: longReport,
      })
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]?.messageBody).toBe(longReport.trim())
      expect(listChatMessagesForSession(db, globalSessionId)).toEqual([])
    })
  })

  // test: recast for the no-harvest pipeline — the short-circuit now guards
  // the CHANNEL distill (an already-short reply never burns a model call).
  it('a SHORT channel reply skips the distill call and reaches the channel as-is', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const now = new Date()
      const channel = insertChannel(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bot',
        botCredentials: JSON.stringify({ botToken: 't' }),
        botMetadata: '{}',
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: null,
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })

      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'quick check',
        origin: { channelId: channel.id, externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
      })

      const distillCalls: SummarizeReportCall[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-short',
        resultText: 'All good.',
        reportReply: 'should never be used',
        summarizeReportInputs: distillCalls,
      })
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      expect(distillCalls).toHaveLength(0)
      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]?.messageBody).toBe('All good.')
      expect(listChatMessagesForSession(db, globalSessionId)).toEqual([])
    })
  })

  it('a channel-driven delegation distills FOR THE CHANNEL and delivers the reply there', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const now = new Date()
      const channel = insertChannel(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bot',
        botCredentials: JSON.stringify({ botToken: 't' }),
        botMetadata: '{}',
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: null,
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })

      const longReport = 'Detailed working notes the channel user should not wade through. '.repeat(20)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
        origin: { channelId: channel.id, externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
      })

      const distillCalls: SummarizeReportCall[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-ch-distill',
        resultText: longReport,
        reportReply: 'Docs summarized: 3 files, all current. ✅',
        summarizeReportInputs: distillCalls,
      })
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      // The distill targeted the ORIGIN channel's kind; the channel gets the
      // short reply. test: recast for the no-harvest pipeline — NO delivery
      // job rides along anymore (the channel answer is the whole output).
      expect(distillCalls[0]?.deliveryTarget).toBe('telegram')
      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]?.messageBody).toBe('Docs summarized: 3 files, all current. ✅')
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'unused' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
          runGlobalRootReportTurn: makeGlobalReportRunner(),
        }),
      ).toBe(false)
      expect(listChatMessagesForSession(db, globalSessionId)).toEqual([])
    })
  })

  it('surface-up: a carded tool PARKS the job, cards the web queue + origin channel, and the decision resumes it to completion', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const now = new Date()
      const channel = insertChannel(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        channelKind: 'telegram',
        displayName: 'Bot',
        botCredentials: JSON.stringify({ botToken: 't' }),
        botMetadata: '{}',
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
        lastPolledCursor: null,
        lastPolledAt: null,
        lastInboundAt: null,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })

      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'update the notes file',
        origin: { channelId: channel.id, externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
      })

      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-park',
        resultText: 'File updated.',
        approvalToolName: 'Write',
      })
      const running = runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      // Poll until the record-and-park lands (the tick is mid-turn, parked).
      await vi.waitFor(() => {
        expect(listPendingApprovalsForUser(db, user.id)).toHaveLength(1)
      })
      const card = listPendingApprovalsForUser(db, user.id)[0]!
      expect(card.workspaceId).toBe(workspace.id)
      expect(card.toolName).toBe('Write')

      // REALTIME persistence: mid-park (the turn far from complete) the routed task
      // already sits in the workspace transcript, attributed + trace-keyed — the
      // shared-pipeline guarantee the Watch panel + workspace chat read live.
      const midRunMessages = listChatMessagesForSession(db, 'ws-root-park')
      expect(midRunMessages).toHaveLength(1)
      expect(midRunMessages[0]).toMatchObject({
        role: 'user',
        body: 'update the notes file',
        sourceKind: 'global-root',
      })
      expect(midRunMessages[0]!.partialSessionId).not.toBeNull()

      // The card ALSO reached the origin channel (with the explicit-id buttons).
      const cardOutbound = listOutboundMessagesForChannel(db, channel.id)
      expect(cardOutbound).toHaveLength(1)
      expect(cardOutbound[0]!.payloadKind).toBe('approval-request')
      expect(cardOutbound[0]!.messageStructure).toContain(`approval:approve:${card.providerApprovalId}`)
      expect(cardOutbound[0]!.messageBody).toContain('in Acme') // the acting workspace, named
      expect(findDelegationJobById(db, jobId)?.status).toBe('claimed') // still parked

      // The user approves (resolveApproval → respondToApprovalRequest) — shortcut
      // straight to the provider here; resolveApproval's own tests cover the row update.
      await provider.respondToApprovalRequest(card.providerApprovalId, { kind: 'approved' })
      await running

      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
      const outbound = listOutboundMessagesForChannel(db, channel.id)
      expect(outbound).toHaveLength(2) // the approval card + the final report
      expect(outbound.map((m) => m.payloadKind).sort()).toEqual([
        'approval-request',
        'chat-stream-final',
      ])
    })
  })

  it('announces the run on the activity feed: started (origin delegation) → session resolved → ended', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
      })

      const activityFeed = new SessionActivityFeed()
      const seen: Array<{ kind: string; workspaceId?: string | null; origin?: string }> = []
      activityFeed.subscribe(user.id, (event) => seen.push(event))

      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'ws-live', resultText: 'ok' }),
        logger: silentLogger,
        activityFeed,
      })

      expect(seen.map((event) => event.kind)).toEqual([
        'turn-started',
        'turn-updated',
        'turn-ended',
      ])
      expect(seen[0]).toMatchObject({
        scopeKind: 'workspace',
        workspaceId: workspace.id,
        origin: 'delegation',
      })
      expect(seen[1]).toMatchObject({ sessionId: 'ws-live' })
      // No zombies: the snapshot is empty after the run.
      const replay: unknown[] = []
      activityFeed.subscribe(user.id, (event) => replay.push(event))
      expect(replay).toHaveLength(0)
    })
  })

  it('a THROWING turn still ends its feed announcement (no zombie turn)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'explode',
      })

      const activityFeed = new SessionActivityFeed()
      const kinds: string[] = []
      activityFeed.subscribe(user.id, (event) => kinds.push(event.kind))

      await runDelegationClaimAndRunTick(db, {
        provider: new ThrowingTurnProvider(),
        logger: silentLogger,
        activityFeed,
      })

      expect(kinds[0]).toBe('turn-started')
      expect(kinds.at(-1)).toBe('turn-ended')
    })
  })

  it('onRunStarted fires synchronously at claim; excludeTargetKeys skips a busy workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const busyWorkspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: busyWorkspace.id,
        workspacePath: busyWorkspace.path,
        workspaceName: busyWorkspace.name,
        taskText: 'wait your turn',
      })

      // The only pending job's workspace is busy → nothing claims.
      const skipped = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'ws-x', resultText: 'ok' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        excludeTargetKeys: new Set([busyWorkspace.id]),
      })
      expect(skipped).toBe(false)
      expect(findDelegationJobById(db, jobId)?.status).toBe('pending')

      // Freed: the claim proceeds and reports itself SYNCHRONOUSLY (before the
      // first await — the pool reserves the target slot on this callback).
      const started: Array<{ jobId: string; targetKey: string }> = []
      const running = runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'ws-y', resultText: 'ok' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        excludeTargetKeys: new Set(),
        onRunStarted: (run) => started.push(run),
      })
      expect(started).toEqual([{ jobId, targetKey: busyWorkspace.id }])
      await running
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
    })
  })

  // ── SESSION targets (session-library Slice ④) ─────────────────────

  it('runs a SESSION-target job through delegateToSpawnedSession — completed surfaced, no delivery', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-tick' }),
        {
          userId: user.id,
          name: 'Research: pricing',
          purpose: 'compare pricing pages',
          workspacePath: '/tmp/vynel/global-root',
        },
      )

      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: '/tmp/vynel/global-root',
        taskText: 'compare pricing',
      })

      // The liveness feed sees a GLOBAL-scoped turn (no workspace to key on).
      const activityFeed = new SessionActivityFeed()
      const turnStarts: Array<{ scopeKind: string; workspaceId: string | null }> = []
      activityFeed.subscribe(user.id, (event) => {
        if (event.kind === 'turn-started') {
          turnStarts.push({ scopeKind: event.scopeKind, workspaceId: event.workspaceId })
        }
      })

      const started: Array<{ jobId: string; targetKey: string }> = []
      const inputs: StartChatSessionInput[] = []
      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: created.sessionId,
          resultText: 'A undercuts us by 12%.',
          startChatSessionInputs: inputs,
        }),
        logger: silentLogger,
        activityFeed,
        onRunStarted: (run) => started.push(run),
      })

      expect(processed).toBe(true)
      // The pool key for a session job is the spawned primary id.
      expect(started).toEqual([{ jobId, targetKey: created.primarySessionId }])
      expect(turnStarts).toEqual([{ scopeKind: 'global', workspaceId: null }])
      // The turn RESUMED the spawned session in the job's stored run cwd.
      expect(inputs[0]!.resumeSessionId).toBe(created.sessionId)
      expect(inputs[0]!.workspacePath).toBe('/tmp/vynel/global-root')

      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')

      // test: recast for the no-harvest pipeline (Chad, locked 2026-07-27) —
      // the session's reply is NOT captured into a delivery; the row settles
      // surfaced, the queue is empty, and the session reports only when IT
      // calls send_message.
      expect(findDelegationJobById(db, jobId)?.surfacedToRootAt).not.toBeNull()
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'unused' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
          runGlobalRootReportTurn: makeGlobalReportRunner(),
        }),
      ).toBe(false)
      expect(listChatMessagesForSession(db, globalSessionId)).toEqual([])
    })
  })

  it('a WORKSPACE-spawned target reports to ITS workspace primary conversation, not the global root (Slice ④b)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      // The creator: a live WORKSPACE primary (chat segment + link) — the
      // conversation the report must land on.
      const wsPrimary = await getOrCreatePrimarySession(db, {
        userId: user.id,
        workspaceId: workspace.id,
      })
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'ws-primary-sdk-1',
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Workspace brain',
          visibility: 'hidden',
        }),
      )
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: wsPrimary.id,
        userId: user.id,
        sdkSessionId: 'ws-primary-sdk-1',
      })

      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-ws-tick' }),
        {
          userId: user.id,
          name: 'Acme research',
          purpose: 'dig into the backlog',
          workspacePath: workspace.path,
          workspaceId: workspace.id,
        },
      )
      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'ws-primary-sdk-1',
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: workspace.path,
        taskText: 'dig in',
      })

      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: created.sessionId,
          resultText: 'Backlog has 4 stale items.',
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(processed).toBe(true)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')

      // test: recast for the no-harvest pipeline (Chad, locked 2026-07-27) —
      // the task tick no longer enqueues the delivery; the SESSION reports by
      // calling send_message, which is what this direct enqueue stands in for.
      // The notify machinery under test is unchanged.
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: created.sessionId,
        reporterLabel: 'Acme research',
        reportBody: 'Backlog has 4 stale items.',
        requester: {
          kind: 'workspace-primary',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        },
      })

      // The next tick runs the WORKSPACE notify turn END-TO-END (the real
      // delegateToWorkspaceRoot machinery): the report lands as the turn's
      // INBOUND message on the workspace primary — attributed FROM the child
      // session — and the workspace's own reply follows.
      const reportCalls: GlobalReportTurnCall[] = []
      const notifyInputs: StartChatSessionInput[] = []
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-primary-sdk-1',
          resultText: 'Noted — I will fold the stale items into the plan.',
          startChatSessionInputs: notifyInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: makeGlobalReportRunner(reportCalls),
      })
      expect(delivered).toBe(true)
      // A WORKSPACE requester never touches the global runner.
      expect(reportCalls).toEqual([])
      // The notify turn RESUMED the workspace primary under the
      // report-delivery steer — never the task steer.
      expect(notifyInputs[0]!.resumeSessionId).toBe('ws-primary-sdk-1')
      expect(notifyInputs[0]!.systemPromptAppend).toContain('This message is a REPORT')
      expect(notifyInputs[0]!.systemPromptAppend).not.toContain('This task was routed')

      const wsMessages = listChatMessagesForSession(db, 'ws-primary-sdk-1')
      expect(wsMessages.map((m) => [m.role, m.sourceKind, m.sourceLabel, m.body])).toEqual([
        [
          'user',
          'workspace-manager',
          'Acme research',
          markedReport('Acme research', 'Backlog has 4 stale items.'),
        ],
        ['assistant', 'workspace-manager', 'Mark · Acme', 'Noted — I will fold the stale items into the plan.'],
      ])
      // …and NOTHING reached the global root's transcript.
      expect(
        listChatMessagesForSession(db, globalSessionId).filter(
          (m) => m.sourceKind === 'workspace-manager',
        ),
      ).toEqual([])

      // Anti-cascade: the completed delivery enqueued NOTHING further.
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'never' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
          runGlobalRootReportTurn: makeGlobalReportRunner(),
        }),
      ).toBe(false)
    })
  })

  it('excludeTargetKeys with the spawned primary id holds a same-session job (FIFO per session)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-busy' }),
        { userId: user.id, name: 'S', purpose: 'p', workspacePath: '/tmp/x' },
      )
      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        targetPrimarySessionId: created.primarySessionId,
        runCwdPath: '/tmp/x',
        taskText: 'queued task',
      })

      const skipped = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'never' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        excludeTargetKeys: new Set([created.primarySessionId]),
      })
      expect(skipped).toBe(false)
      expect(findDelegationJobById(db, jobId)?.status).toBe('pending')
    })
  })

  it('GLOBAL deliveries share one exclusion key: at most one runs, the rest stay PENDING while a workspace task claims alongside', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await setUpGlobalRoot(db, user.id)

      // Two pending GLOBAL deliveries + one workspace task on the queue.
      //
      // STAGGERED CLOCKS, deliberately: the claim orders by (createdAt, id), so
      // three rows enqueued back-to-back can land in ONE millisecond — and the
      // tie-break is then a random uuid, handing the first claim to the
      // workspace task about a third of the time. This test asserts FIFO
      // ordering, so it has to pin the order it is asserting.
      const enqueuedAt = (offsetMs: number) => ({ now: () => new Date(1_700_000_000_000 + offsetMs) })
      const deliveryIds = [
        enqueueReportDelivery(db, {
          userId: user.id,
          reporterSessionId: 'reporter-1',
          reporterLabel: 'Session A',
          reportBody: 'report one',
          requester: { kind: 'global-root' },
        }, enqueuedAt(0)),
        enqueueReportDelivery(db, {
          userId: user.id,
          reporterSessionId: 'reporter-2',
          reporterLabel: 'Session B',
          reportBody: 'report two',
          requester: { kind: 'global-root' },
        }, enqueuedAt(1)),
      ]
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'a task that must not starve',
      }, enqueuedAt(2))

      // Tick A (no exclusion): claims ONE delivery and reports the SHARED
      // synthetic key — what the pool will hold for the run's life.
      const started: Array<{ jobId: string; targetKey: string }> = []
      const firstRunnerCalls: GlobalReportTurnCall[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: makeGlobalReportRunner(firstRunnerCalls),
        onRunStarted: (run) => started.push(run),
      })
      expect(started[0]!.targetKey).toBe(GLOBAL_ROOT_DELIVERY_TARGET_KEY)
      expect(firstRunnerCalls).toHaveLength(1)

      // Tick B, key held (the pool's exclusion set): the SECOND delivery stays
      // pending — the workspace TASK claims instead (no starvation either way).
      const secondRunnerCalls: GlobalReportTurnCall[] = []
      const taskInputs: StartChatSessionInput[] = []
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({
          seededSessionId: 'ws-root-alongside',
          resultText: 'task done',
          startChatSessionInputs: taskInputs,
        }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: makeGlobalReportRunner(secondRunnerCalls),
        excludeTargetKeys: new Set([GLOBAL_ROOT_DELIVERY_TARGET_KEY]),
        onRunStarted: (run) => started.push(run),
      })
      expect(secondRunnerCalls).toEqual([])
      expect(started[1]!.targetKey).toBe(workspace.id)
      expect(taskInputs).toHaveLength(1)

      // Exactly one delivery completed; the other is still PENDING (waiting
      // for the key, its budget untouched — never failed, never lost).
      const deliveryStatuses = deliveryIds
        .map((id) => findDelegationJobById(db, id)?.status)
        .sort()
      expect(deliveryStatuses).toEqual(['completed', 'pending'])
    })
  })

  it('a GLOBAL report-delivery job without the injected runner fails cleanly — never stuck claimed, task job untouched', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const taskJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'produce a report',
      })
      await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ seededSessionId: 'ws-root-norunner', resultText: 'done' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(findDelegationJobById(db, taskJobId)?.status).toBe('completed')

      // test: recast for the no-harvest pipeline — the task tick no longer
      // enqueues deliveries; the direct enqueue stands in for the workspace's
      // own send_message call.
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-root-norunner',
        reporterLabel: 'Mark · Acme',
        reportBody: 'done',
        requester: { kind: 'global-root' },
      })

      // The delivery tick runs WITHOUT runGlobalRootReportTurn (an MCP-less
      // harness shape) — the delivery job fails with an actionable message.
      const delivered = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'unused' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(delivered).toBe(true)
      // The delivery reached a TERMINAL state (the queue is drained — a stuck
      // `claimed`/`pending` row would keep claiming) and the TASK job's
      // completion survived untouched.
      expect(findDelegationJobById(db, taskJobId)?.status).toBe('completed')
      expect(
        await runDelegationClaimAndRunTick(db, {
          provider: new FakeAiAgentProvider({ resultText: 'never' }),
          logger: silentLogger,
          activityFeed: new SessionActivityFeed(),
        }),
      ).toBe(false)
    })
  })

  it('fails (never strands) a SESSION-target job whose spawned session is gone', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const globalSessionId = await setUpGlobalRoot(db, user.id)
      const jobId = enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        targetPrimarySessionId: randomUUID(), // no such primary
        runCwdPath: '/tmp/x',
        taskText: 'orphan task',
      })

      const processed = await runDelegationClaimAndRunTick(db, {
        provider: new FakeAiAgentProvider({ resultText: 'never' }),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
      })
      expect(processed).toBe(true)
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('failed')
      expect(job?.errorMessage).toMatch(/not found or not owned/)
    })
  })
})

// Integration test for `runDelegationClaimAndRunTick` (brain-tree Chapter 1, async core) —
// the deterministic end-to-end of the async loop with a fake provider: enqueue → claim →
// run the workspace-root turn → push the report UP to the global root → complete. Real
// SQLite, no live SDK.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
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
  findDelegationJobById,
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

  it('claims a pending job, runs it, completes it, and pushes the report up to the global root', async () => {
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

      // The job reached `completed` with the result text.
      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('completed')
      expect(job?.resultText).toBe('Acme has 3 docs; all current.')

      // Brain-tree Chapter 2: the request minted a correlation key, and the WHOLE chain
      // shares it — the workspace task + reply AND the bubbled-up global report. Read back
      // via the trace key, the faithful chain is task → workspace-reply → global-report
      // (the reply + report carry the same body; both are present — no dedup).
      const traceKey = job?.partialSessionId
      expect(typeof traceKey).toBe('string')
      expect(listChatMessagesByPartialSessionId(db, traceKey!).map((m) => m.body)).toEqual([
        'summarize the docs',
        'Acme has 3 docs; all current.',
        'Acme has 3 docs; all current.',
      ])

      // End-to-end through the REAL taggers: resolveDelegationTrace returns the faithful,
      // attributed chain (the trace foundation Ch3 renders) — locks the taggers↔trace contract.
      const trace = resolveDelegationTrace(db, { userId: user.id, partialSessionId: traceKey! })
      expect(trace.entries.map((e) => [e.sourceKind, e.sourceLabel, e.body])).toEqual([
        ['global-root', null, 'summarize the docs'],
        ['workspace-manager', 'Mark · Acme', 'Acme has 3 docs; all current.'],
        ['workspace-manager', 'Mark · Acme', 'Acme has 3 docs; all current.'],
      ])

      // The workspace transcript got the attributed task + reply.
      expect(
        listChatMessagesForSession(db, 'ws-root-new').map((m) => [m.role, m.sourceKind, m.sourceLabel]),
      ).toEqual([
        ['user', 'global-root', null],
        ['assistant', 'workspace-manager', 'Mark · Acme'],
      ])

      // The report bubbled UP to the global root's transcript, attributed.
      expect(
        listChatMessagesForSession(db, globalSessionId).map((m) => [
          m.role,
          m.sourceKind,
          m.sourceLabel,
          m.body,
        ]),
      ).toEqual([['assistant', 'workspace-manager', 'Mark · Acme', 'Acme has 3 docs; all current.']])
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

  it('distills a LONG report into the user reply — summary lands in global, the FULL report stays on the job + trace', async () => {
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

      // The distill saw the full report + the task, targeting the chat surface.
      expect(distillCalls).toHaveLength(1)
      expect(distillCalls[0]).toMatchObject({
        taskText: 'audit the docs',
        reportText: drainedReport,
        workspaceName: 'Acme',
        deliveryTarget: 'chat',
      })

      // Global got the SHORT reply; the job row keeps the FULL report (the trace truth).
      expect(listChatMessagesForSession(db, globalSessionId).map((m) => m.body)).toEqual([
        'Done — all docs are current and cross-linked.',
      ])
      expect(findDelegationJobById(db, jobId)?.resultText).toBe(drainedReport)
      // The workspace transcript keeps the full reply too — the Watch drill-down's body.
      expect(
        listChatMessagesForSession(db, 'ws-root-distill').map((m) => m.body),
      ).toEqual(['audit the docs', longReport])
    })
  })

  it('falls open to the FULL report when the provider cannot distill', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const globalSessionId = await setUpGlobalRoot(db, user.id)

      const longReport = 'Line of detailed findings the user still needs. '.repeat(20)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: globalSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'audit the docs',
      })

      // No reportReply configured → summarizeReport returns null (unsupported).
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-noreply',
        resultText: longReport,
      })
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger, activityFeed: new SessionActivityFeed() })

      expect(listChatMessagesForSession(db, globalSessionId).map((m) => m.body)).toEqual([
        longReport.trim(),
      ])
    })
  })

  it('a SHORT report skips the distill call and delivers as-is', async () => {
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
        taskText: 'quick check',
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
      expect(listChatMessagesForSession(db, globalSessionId).map((m) => m.body)).toEqual([
        'All good.',
      ])
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

      // The distill targeted the ORIGIN channel's kind, and BOTH surfaces got the
      // same short reply — the channel message and the global row.
      expect(distillCalls[0]?.deliveryTarget).toBe('telegram')
      const queued = listOutboundMessagesForChannel(db, channel.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]?.messageBody).toBe('Docs summarized: 3 files, all current. ✅')
      expect(listChatMessagesForSession(db, globalSessionId).map((m) => m.body)).toEqual([
        'Docs summarized: 3 files, all current. ✅',
      ])
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

  it('runs a SESSION-target job through delegateToSpawnedSession and pushes the report labeled with the session name', async () => {
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

      // The report pushed onto the global root, labeled as the SESSION.
      const rootMessages = listChatMessagesForSession(db, globalSessionId)
      const report = rootMessages.find((m) => m.sourceKind === 'workspace-manager')
      expect(report?.sourceLabel).toBe('Research: pricing')
      expect(report?.body).toBe('A undercuts us by 12%.')
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

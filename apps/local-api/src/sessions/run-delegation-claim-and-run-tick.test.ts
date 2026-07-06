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
import type { StartChatSessionInput } from '@vynel/providers'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  listChatMessagesForSession,
  listChatMessagesByPartialSessionId,
  insertChatSession,
} from '@vynel/chat/repositories'
import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import { insertChannel, listOutboundMessagesForChannel } from '@vynel/channels/test-support'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '@vynel/session/continuity'
import { buildNewChatSessionRow } from '@vynel/chat'
import { FakeAiAgentProvider } from './test-support/fake-ai-agent-provider.js'
import { resolveDelegationTrace } from './resolve-delegation-trace.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

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
      const processed = await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger })

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
      expect(await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger })).toBe(false)
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
      const processed = await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger })

      expect(processed).toBe(true)
      expect(findDelegationJobById(db, jobId)?.status).toBe('completed')
      // The workspace transcript still received the exchange.
      expect(listChatMessagesForSession(db, 'ws-root-2')).toHaveLength(2)
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
      await runDelegationClaimAndRunTick(db, { provider, logger: silentLogger })

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
      const running = runDelegationClaimAndRunTick(db, { provider, logger: silentLogger })

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
})

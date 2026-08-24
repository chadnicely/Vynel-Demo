// Integration test for `delegateToWorkspaceRoot` (brain-tree Phase 1) — routing a
// task into a workspace's continuing PRIMARY brain. Real SQLite + a fake provider, so
// the recording (segment + link + edge + attributed messages) is exercised without
// a live SDK.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { composeSessionInstruction } from '@vynel/instructions/session-instructions'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '@vynel/orchestration'
import { findPrimaryConversation } from '../continuity/index.js'
import { resolvePrimaryTranscript } from '../runtime/resolve-primary-transcript.js'
import type { AiAgentProvider, NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import { ROUTED_LEAF_WRITE_BLOCKED_NOTE } from '@vynel/orchestration'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { delegateToWorkspaceRoot } from './delegate-to-workspace-root.js'
import {
  ROUTED_TASK_INSTRUCTIONS,
  REPORT_DELIVERY_INSTRUCTIONS,
} from './routed-turn-provider-input.js'

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
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('delegateToWorkspaceRoot', () => {
  it('runs the task on the workspace root, records the segment + edge, and persists attributed', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const startChatSessionInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-new',
        resultText: 'Acme has 3 docs; all current.',
        startChatSessionInputs,
      })

      const observedKinds: string[] = []
      let observedEnd = false
      const result = await delegateToWorkspaceRoot(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
        providerId: 'claude',
        observer: {
          onTurnEvent: (event) => observedKinds.push(event.kind),
          onTurnEnded: () => {
            observedEnd = true
          },
        },
      })

      // Live observing: every turn event was forwarded, and the end fired (the
      // SSE observe stream's close signal).
      expect(observedKinds).toContain('text-chunk')
      expect(observedKinds).toContain('session-completed')
      expect(observedEnd).toBe(true)

      // Reports up the clean result + the workspace-root reference.
      expect(result.reference).toBe('ws-root-new')
      expect(result.resultText).toBe('Acme has 3 docs; all current.')

      // test: correct expectation for the base+kind stack — the manager
      // identity (base + workspace-manager) now LEADS the routed steer, so the
      // primary keeps one identity whichever door the turn came through.
      expect(startChatSessionInputs[0]!.systemPromptAppend).toBe(
        `${composeSessionInstruction('workspace-manager')}\n\n${ROUTED_TASK_INSTRUCTIONS}`,
      )

      // The fresh workspace-root segment was recorded (hidden, workspace-scoped).
      const segment = findChatSessionById(db, 'ws-root-new')
      expect(segment?.workspaceId).toBe(workspace.id)
      expect(segment?.visibility).toBe('hidden')

      // The workspace primary now points at the session the turn ran on.
      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary?.currentSdkSessionId).toBe('ws-root-new')

      // The global → workspace-root tree edge was emitted for the monitor.
      const edges = listOutboxEventsByType(db, SESSION_DELEGATED)
      expect(edges).toHaveLength(1)
      const edge = edges[0]!.payload as SessionDelegatedPayload
      expect(edge.parentSessionId).toBe('global-sdk-1')
      expect(edge.childSessionId).toBe('ws-root-new')
      expect(edge.role).toBe('workspace-root')

      // The routed exchange persisted to the workspace transcript, attributed.
      const messages = listChatMessagesForSession(db, 'ws-root-new')
      expect(messages.map((m) => [m.role, m.sourceKind, m.sourceLabel])).toEqual([
        ['user', 'global-root', null],
        ['assistant', 'workspace-manager', 'Acme'],
      ])
    })
  })

  it('the REPORT-DELIVERY variant: inbound row attributed FROM the child, the report steer replaces the task steer, defaults untouched otherwise', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const startChatSessionInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-notify',
        resultText: 'Noted.',
        startChatSessionInputs,
      })

      await delegateToWorkspaceRoot(db, provider, {
        parentSessionId: 'spawned-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'Backlog has 4 stale items.',
        providerId: 'claude',
        inboundAttribution: { sourceKind: 'workspace-manager', sourceLabel: 'Acme research' },
        steerInstructions: REPORT_DELIVERY_INSTRUCTIONS,
      })

      // The steer swapped wholesale — never both; the identity still leads.
      expect(startChatSessionInputs[0]!.systemPromptAppend).toBe(
        `${composeSessionInstruction('workspace-manager')}\n\n${REPORT_DELIVERY_INSTRUCTIONS}`,
      )

      // The INBOUND row reads as the child's report; the reply keeps the
      // workspace's own manager identity.
      const messages = listChatMessagesForSession(db, 'ws-root-notify')
      expect(messages.map((m) => [m.role, m.sourceKind, m.sourceLabel, m.body])).toEqual([
        ['user', 'workspace-manager', 'Acme research', 'Backlog has 4 stale items.'],
        ['assistant', 'workspace-manager', 'Acme', 'Noted.'],
      ])
    })
  })

  it('threads the MCP attachment into the provider turn (servers + allow/deny + carded mutators + joined prompt)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const startChatSessionInputs: StartChatSessionInput[] = []
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'ws-root-mcp',
        resultText: 'done',
        startChatSessionInputs,
      })

      const vynelServer = { name: 'vynel' }
      await delegateToWorkspaceRoot(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'file the docs',
        providerId: 'claude',
        mcpAttachment: {
          mcpServers: { vynel: vynelServer },
          deniedMcpToolPatterns: ['mcp__vynel__search_knowledge'],
          mutatingToolNames: ['mcp__vynel__register_workspace'],
          askModeApprovalToolNames: ['mcp__vynel__remove_knowledge_source'],
          systemPromptAppend: '## Task list\nKeep it current.',
        },
      })

      const turnInput = startChatSessionInputs[0]!
      // The resumed session keeps the SAME background toolset a schedule fire
      // attaches — a bare turn would strip its deferred tools ("disconnected").
      expect(turnInput.mcpServers).toEqual({ vynel: vynelServer })
      // No wildcard patterns ride to the provider — registration alone offers
      // the tools; the canUseTool policy map gates each call (SHADOWED fix).
      expect('allowedMcpToolPatterns' in turnInput).toBe(false)
      expect(turnInput.deniedToolNames).toEqual(['mcp__vynel__search_knowledge'])
      expect(turnInput.alwaysRequireApprovalToolNames).toEqual(['mcp__vynel__register_workspace'])
      expect(turnInput.askModeApprovalToolNames).toEqual(['mcp__vynel__remove_knowledge_source'])
      // Identity first, the routed steer next, the composer's feature sections last.
      expect(turnInput.systemPromptAppend).toBe(
        `${composeSessionInstruction('workspace-manager')}\n\n${ROUTED_TASK_INSTRUCTIONS}\n\n## Task list\nKeep it current.`,
      )
    })
  })

  it('resumes an already-recorded workspace root without re-recording the segment', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      // First delegation creates + records the workspace root segment 'ws-root-a'.
      const firstProvider = new FakeAiAgentProvider({ seededSessionId: 'ws-root-a', resultText: 'first' })
      await delegateToWorkspaceRoot(db, firstProvider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'first task',
        providerId: 'claude',
      })

      // Second delegation resumes the SAME session id (no swap) — no new segment.
      const secondProvider = new FakeAiAgentProvider({ seededSessionId: 'ws-root-a', resultText: 'second' })
      const result = await delegateToWorkspaceRoot(db, secondProvider, {
        parentSessionId: 'global-sdk-2',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'second task',
        providerId: 'claude',
      })

      expect(result.resultText).toBe('second')
      // Both turns' messages accumulate on the one root segment (2 turns × 2 msgs).
      const messages = listChatMessagesForSession(db, 'ws-root-a')
      expect(messages).toHaveLength(4)
      // Two delegation edges (one per turn).
      expect(listOutboxEventsByType(db, SESSION_DELEGATED)).toHaveLength(2)
    })
  })

  it('trips the denial breaker: two denied decisions interrupt the leaf ONCE and append the blocked note', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      // A scripted provider: two carded proposals, both denied (e.g. by the user or
      // the reaper), then the interrupt lands as a terminal event — the drain-test
      // style, but through the SHARED pipeline the routed path now runs on.
      const interrupted: string[] = []
      const scripted = {
        startChatSession(): AsyncIterable<NormalizedSessionEvent> {
          return (async function* () {
            yield {
              kind: 'session-started',
              sessionId: 'ws-root-breaker',
              resumedFromExisting: false,
              startedAt: new Date(),
            } as NormalizedSessionEvent
            yield {
              kind: 'text-chunk',
              sessionId: 'ws-root-breaker',
              messageId: 'm-breaker',
              textDelta: 'Here is what I found.',
              isFinalChunk: false,
            } as NormalizedSessionEvent
            for (const id of ['appr-1', 'appr-2']) {
              yield {
                kind: 'approval-requested',
                sessionId: 'ws-root-breaker',
                approvalRequestId: id,
                parentMessageId: 'm-breaker',
                toolName: 'Write',
                toolInput: {},
                requestedAt: new Date(),
              } as NormalizedSessionEvent
              yield {
                kind: 'approval-resolved',
                sessionId: 'ws-root-breaker',
                approvalRequestId: id,
                decision: { kind: 'denied', reason: 'no' },
                resolvedAt: new Date(),
              } as NormalizedSessionEvent
            }
            yield {
              kind: 'session-interrupted',
              sessionId: 'ws-root-breaker',
              interruptedAt: new Date(),
            } as NormalizedSessionEvent
          })()
        },
        interruptChatSession: async (sessionId: string) => {
          interrupted.push(sessionId)
        },
      } as unknown as AiAgentProvider

      const result = await delegateToWorkspaceRoot(db, scripted, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'write the config',
        providerId: 'claude',
      })

      expect(interrupted).toEqual(['ws-root-breaker']) // interrupted exactly once
      expect(result.resultText).toContain('Here is what I found.')
      expect(result.resultText).toContain(ROUTED_LEAF_WRITE_BLOCKED_NOTE)
    })
  })

  it('fail-closed on a mid-turn pipeline throw: interrupts the leaf session, then rethrows', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const interrupted: string[] = []
      const scripted = {
        startChatSession(): AsyncIterable<NormalizedSessionEvent> {
          return (async function* () {
            yield {
              kind: 'session-started',
              sessionId: 'ws-root-throw',
              resumedFromExisting: false,
              startedAt: new Date(),
            } as NormalizedSessionEvent
            throw new Error('provider transport died')
          })()
        },
        interruptChatSession: async (sessionId: string) => {
          interrupted.push(sessionId)
        },
      } as unknown as AiAgentProvider

      let observedEnd = false
      await expect(
        delegateToWorkspaceRoot(db, scripted, {
          parentSessionId: 'global-sdk-1',
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          workspaceName: workspace.name,
          taskText: 'anything',
          providerId: 'claude',
          observer: {
            onTurnEvent: () => {},
            onTurnEnded: () => {
              observedEnd = true
            },
          },
        }),
      ).rejects.toThrow('provider transport died')

      // The leaf was torn down — no background agent left parked on a dead turn —
      // and the observe stream was closed (onTurnEnded fires on a throw too).
      expect(interrupted).toEqual(['ws-root-throw'])
      expect(observedEnd).toBe(true)
    })
  })

  it('bridges the workspace primary at the turn boundary when the routed turn left it over the pressure threshold', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      // Two SDK starts through one fake: the routed turn (segment A), then the
      // swap's seeded priming session (segment B). The turn's usage report
      // lands A at 0.95 of Haiku's window.
      const provider = new FakeAiAgentProvider({
        sessionIds: ['ws-root-a', 'ws-root-b'],
        resultText: 'Acme has 3 docs; all current.',
        usage: { inputTokens: 190_000, outputTokens: 10, model: 'claude-haiku-4-5' },
        summary: 'GOAL: finish the routed task. DONE: the docs are summarized. NEXT: await the next task. FACTS: three docs, all current.',
      })

      const observedKinds: string[] = []
      const result = await delegateToWorkspaceRoot(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
        providerId: 'claude',
        observer: { onTurnEvent: (event) => observedKinds.push(event.kind), onTurnEnded: () => {} },
      })

      // The task itself ran (and is reported) on segment A. Observers (the
      // tick's feed tap, the observe stream) saw the swap announced in-stream.
      expect(result.reference).toBe('ws-root-a')
      expect(observedKinds.slice(-3)).toEqual(['session-completed', 'context-patching', 'context-patched'])
      expect(result.resultText).toBe('Acme has 3 docs; all current.')

      // Boundary swap: the primary now points at the fresh seeded segment B,
      // chained to A, filed under the workspace, hidden like every segment.
      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary?.currentSdkSessionId).toBe('ws-root-b')
      expect(primary?.supersededFromSdkSessionId).toBe('ws-root-a')
      const fresh = findChatSessionById(db, 'ws-root-b')
      expect(fresh?.continuedFromSessionId).toBe('ws-root-a')
      expect(fresh?.workspaceId).toBe(workspace.id)
      expect(fresh?.scope).toBe('workspace')
      expect(fresh?.visibility).toBe('hidden')

      // Never lose chat: the workspace thread, read from the new head, still
      // shows the routed exchange that happened on A.
      const transcript = resolvePrimaryTranscript(db, { userId: user.id, workspaceId: workspace.id })
      expect(transcript.session?.id).toBe('ws-root-b')
      expect(transcript.messages.map((m) => m.body)).toEqual([
        'summarize the docs',
        'Acme has 3 docs; all current.',
      ])
    })
  })

  it('a routed turn under the threshold leaves the primary on its segment (no swap)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const provider = new FakeAiAgentProvider({
        sessionIds: ['ws-root-a', 'ws-root-b'],
        resultText: 'ok',
        usage: { inputTokens: 10_000, outputTokens: 10, model: 'claude-haiku-4-5' },
        summary: 'GOAL: finish the routed task. DONE: the docs are summarized. NEXT: await the next task. FACTS: three docs, all current.',
      })

      await delegateToWorkspaceRoot(db, provider, {
        parentSessionId: 'global-sdk-1',
        userId: user.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'quick one',
        providerId: 'claude',
      })

      const primary = findPrimaryConversation(db, { userId: user.id, workspaceId: workspace.id })
      expect(primary?.currentSdkSessionId).toBe('ws-root-a')
      expect(findChatSessionById(db, 'ws-root-b')).toBeNull()
    })
  })
})

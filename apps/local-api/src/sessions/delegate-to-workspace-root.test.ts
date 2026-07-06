// Integration test for `delegateToWorkspaceRoot` (brain-tree Phase 1) — routing a
// task into a workspace's continuing PRIMARY brain. Real SQLite + a fake provider, so
// the recording (segment + link + edge + attributed messages) is exercised without
// a live SDK.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findChatSessionById, listChatMessagesForSession } from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_DELEGATED, type SessionDelegatedPayload } from '@vynel/orchestration'
import { findPrimaryConversation } from '@vynel/session/continuity'
import type { AiAgentProvider, NormalizedSessionEvent, StartChatSessionInput } from '@vynel/providers'
import { ROUTED_LEAF_WRITE_BLOCKED_NOTE } from '@vynel/orchestration'
import { FakeAiAgentProvider } from './test-support/fake-ai-agent-provider.js'
import { delegateToWorkspaceRoot, ROUTED_TASK_INSTRUCTIONS } from './delegate-to-workspace-root.js'

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

      // The background steer rides the SYSTEM prompt, never the persisted task text.
      expect(startChatSessionInputs[0]!.systemPromptAppend).toBe(ROUTED_TASK_INSTRUCTIONS)

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
})

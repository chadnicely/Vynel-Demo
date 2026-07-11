// Test for `resolveDelegationTrace` (brain-tree Chapter 2, the trace-read) — real SQLite.
// Sets up a tagged delegation chain (job + messages stamped with one partialSessionId)
// and verifies: the FAITHFUL chain comes back ordered (ack → task → workspace reply →
// global report, reply + report sharing a body, both present — no dedup); a cross-user
// request gets an empty trace (the tenant gate, no enumeration leak); an unknown key gets
// an empty trace.
//
// Seeding goes through the PUBLISHED orchestration surface (`enqueueWorkspaceDelegation`
// mints the job + its correlation key; `listInFlightDelegations` reads the key back) —
// the raw job repo is not exported from `@vynel/orchestration`. The seeded job therefore
// stays `pending`; the terminal-status pass-through is a plain field copy off the same
// anchor row.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { enqueueWorkspaceDelegation, listInFlightDelegations } from '@vynel/orchestration'
import { buildNewChatSessionRow } from '@vynel/chat'
import {
  insertChatToolCall,
  insertChatSession,
  insertChatMessage,
  type NewChatMessage,
} from '@vynel/chat/repositories'
import { resolveDelegationTrace } from './resolve-delegation-trace.js'

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

function makeMessage(sessionId: string, overrides: Partial<NewChatMessage>): NewChatMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body: '',
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    ...overrides,
  }
}

// Seed a complete tagged chain owned by `userId`: the job (the ownership anchor — its
// minted key read back off the in-flight list) + the task & reply on a workspace
// transcript + the ack & report on a global transcript. The report's startedAt is
// strictly later (a real turn runs in between).
function seedTaggedChain(
  db: Database,
  userId: string,
  workspaceId: string,
): { workspaceSessionId: string; globalSessionId: string; partialSessionId: string } {
  const workspaceSessionId = `ws-${randomUUID()}`
  const globalSessionId = `global-${randomUUID()}`
  const now = new Date()
  // The workspace-root session carries its workspaceId (→ scope 'workspace'); the global-root
  // session has none (→ scope 'global'). This is what the trace's `scope` is derived from.
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: workspaceSessionId,
      userId,
      workspaceId,
      providerId: 'claude',
      startedAt: now,
      title: 'T',
    }),
  )
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: globalSessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: now,
      title: 'T',
    }),
  )

  enqueueWorkspaceDelegation(db, {
    userId,
    parentSessionId: globalSessionId,
    workspaceId,
    workspacePath: '/tmp/vynel/acme',
    workspaceName: 'Acme',
    taskText: 'summarize the notes',
  })
  const [inFlight] = listInFlightDelegations(db, { userId })
  const partialSessionId = inFlight!.partialSessionId!

  const ackTime = new Date('2026-04-30T23:59:00Z') // the global turn — before the workspace runs
  const taskTime = new Date('2026-05-01T00:00:00Z')
  const reportTime = new Date('2026-05-01T00:00:05Z') // strictly later — the turn ran in between
  // The Ch3.5 acknowledgement — `global-root`, on the GLOBAL session, tagged with the key,
  // EARLIEST. The regression: it shares sourceKind with the task, so the old "first
  // global-root entry = workspace session" inference picked the global session.
  insertChatMessage(
    db,
    makeMessage(globalSessionId, {
      role: 'assistant',
      body: 'Sent. Acme is working on it.',
      sourceKind: 'global-root',
      sourceLabel: null,
      partialSessionId,
      startedAt: ackTime,
    }),
  )
  // Task + reply co-committed on the workspace transcript (one shared instant).
  insertChatMessage(
    db,
    makeMessage(workspaceSessionId, {
      role: 'user',
      body: 'summarize the notes',
      sourceKind: 'global-root',
      sourceLabel: null,
      partialSessionId,
      startedAt: taskTime,
    }),
  )
  insertChatMessage(
    db,
    makeMessage(workspaceSessionId, {
      role: 'assistant',
      body: 'Three notes; all current.',
      sourceKind: 'workspace-manager',
      sourceLabel: 'Acme',
      partialSessionId,
      startedAt: taskTime,
    }),
  )
  // The same answer pushed UP to the global transcript (strictly later).
  insertChatMessage(
    db,
    makeMessage(globalSessionId, {
      role: 'assistant',
      body: 'Three notes; all current.',
      sourceKind: 'workspace-manager',
      sourceLabel: 'Acme',
      partialSessionId,
      startedAt: reportTime,
    }),
  )

  return { workspaceSessionId, globalSessionId, partialSessionId }
}


// A minimal tool-call row attached to a trace message — the panel's mid-turn rows.
function insertToolCallForMessage(db: Database, parentMessageId: string) {
  return insertChatToolCall(db, {
    id: randomUUID(),
    parentMessageId,
    toolUseId: randomUUID(),
    toolName: 'Write',
    toolInput: { file_path: '/tmp/x' },
    toolOutput: null,
    status: 'started',
    approvalStatus: null,
    isErrorResult: false,
    startedAt: new Date(),
    completedAt: null,
  })
}

describe('resolveDelegationTrace', () => {
  it('returns the faithful, ordered, SCOPED chain — ack, task, reply, report', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const { workspaceSessionId, globalSessionId, partialSessionId } = seedTaggedChain(
        db,
        user.id,
        workspace.id,
      )

      const trace = resolveDelegationTrace(db, { userId: user.id, partialSessionId })

      expect(trace.partialSessionId).toBe(partialSessionId)
      expect(trace.status).toBe('pending') // the anchor's live status — drives the poll
      // The scope is derived from the session's workspaceId, NOT sourceKind: the
      // acknowledgement and the task are BOTH `global-root`, yet the ack is scope 'global'
      // (its session is /global) and the task is scope 'workspace' (the drill-down target).
      expect(trace.entries.map((e) => [e.sourceKind, e.scope, e.sessionId])).toEqual([
        ['global-root', 'global', globalSessionId], // the Ch3.5 ack — NOT a drill target
        ['global-root', 'workspace', workspaceSessionId], // the task
        ['workspace-manager', 'workspace', workspaceSessionId], // the reply (the drill target)
        ['workspace-manager', 'global', globalSessionId], // the surfaced report
      ])

      // Tool calls ride the assistant entry that owns them (live rows — the panel
      // shows them mid-turn); user rows carry an empty list.
      const reply = trace.entries[2]!
      const replyToolCalls = insertToolCallForMessage(db, reply.id)
      const refreshed = resolveDelegationTrace(db, { userId: user.id, partialSessionId })
      expect(refreshed.entries[2]!.toolCalls.map((t) => t.id)).toEqual([replyToolCalls.id])
      expect(refreshed.entries[1]!.toolCalls).toEqual([])
    })
  })

  it('returns an empty trace for another user (the tenant gate — no enumeration leak)', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const { partialSessionId } = seedTaggedChain(db, owner.id, workspace.id)
      const intruder = insertUser(db, makeUser())

      const trace = resolveDelegationTrace(db, { userId: intruder.id, partialSessionId })

      expect(trace.entries).toEqual([])
      expect(trace.status).toBeNull()
    })
  })

  it('returns an empty trace for an unknown key', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const trace = resolveDelegationTrace(db, { userId: user.id, partialSessionId: 'no-such-key' })
      expect(trace.entries).toEqual([])
      expect(trace.status).toBeNull()
    })
  })
})

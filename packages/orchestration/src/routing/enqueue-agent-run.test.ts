// Integration tests for `enqueueAgentRun` (chat-mentions) — real SQLite.
// Proves the AGENT-RUN row shape: jobKind 'agent-run', agentSlug set, grounding
// + run cwd + requester threading, and the pending/correlation contract shared
// with the sibling enqueue ops.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findDelegationJobById } from '../repositories/index.js'
import { enqueueAgentRun } from './enqueue-agent-run.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
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
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('enqueueAgentRun', () => {
  it('inserts a pending agent-run row: slug, grounding, cwd, label, correlation key', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'origin-sdk-1',
        agentSlug: 'code-reviewer',
        agentName: 'Code Reviewer',
        taskText: '@code-reviewer look at the diff',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        requesterWorkspaceId: workspace.id,
      })

      const job = findDelegationJobById(db, jobId)
      expect(job?.status).toBe('pending')
      expect(job?.jobKind).toBe('agent-run')
      expect(job?.agentSlug).toBe('code-reviewer')
      expect(job?.workspaceId).toBe(workspace.id)
      expect(job?.workspacePath).toBe(workspace.path)
      expect(job?.workspaceName).toBe('Code Reviewer')
      expect(job?.requesterWorkspaceId).toBe(workspace.id)
      expect(job?.targetPrimarySessionId).toBeNull()
      expect(job?.taskText).toBe('@code-reviewer look at the diff')
      expect(job?.parentSessionId).toBe('origin-sdk-1')
      expect(job?.partialSessionId).not.toBeNull()
      expect(job?.threadId).not.toBeNull()
      // Omitted picks stay null (the routed default applies at claim time);
      // persona-sessions: an explicit permissionMode/target DOES thread now.
      expect(job?.permissionMode).toBeNull()
      expect(job?.thinkingEffort).toBeNull()
    })
  })

  it('a GLOBAL-chat mention grounds nowhere and reports to the global root', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const jobId = enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'root-sdk-1',
        agentSlug: 'researcher',
        agentName: 'Researcher',
        taskText: '@researcher dig in',
        workspaceId: null,
        runCwdPath: '/tmp/vynel/global-root',
        model: 'claude-haiku-4-5',
      })
      const job = findDelegationJobById(db, jobId)
      expect(job?.workspaceId).toBeNull()
      expect(job?.requesterWorkspaceId).toBeNull()
      expect(job?.workspacePath).toBe('/tmp/vynel/global-root')
      expect(job?.model).toBe('claude-haiku-4-5')
    })
  })

  it('fails fast on an empty slug or cwd', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const base = {
        userId: user.id,
        parentSessionId: 'x',
        agentName: 'A',
        taskText: 't',
        workspaceId: null,
      }
      expect(() =>
        enqueueAgentRun(db, { ...base, agentSlug: '  ', runCwdPath: '/tmp/x' }),
      ).toThrow(/agentSlug/)
      expect(() =>
        enqueueAgentRun(db, { ...base, agentSlug: 'a', runCwdPath: ' ' }),
      ).toThrow(/runCwdPath/)
    })
  })
})

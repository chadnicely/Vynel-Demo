// The delegated half of auto-continue, pinned on the real queue ops + real
// SQLite: a completed work job whose turn left a checkpoint enqueues ONE
// follow-up job of the same shape (target, chain, mode/model/effort, origin,
// requester) carrying the continuation instruction; nothing pending → nothing
// enqueued; a note never continues; the runaway cap holds; a genuine job start
// drops a stale checkpoint.

import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import {
  claimNextPendingDelegationJob,
  completeDelegationJob,
  enqueueAgentRun,
  enqueueNoteDelivery,
  enqueueSessionDelegation,
  enqueueWorkspaceDelegation,
  findDelegationJobById,
} from '@vynel/orchestration'
import {
  MAX_CONSECUTIVE_CONTINUATIONS,
  clearPendingCheckpoint,
  markPendingCheckpoint,
  peekPendingCheckpoint,
  takeContinuationJob,
} from '../continuity/pending-checkpoints.js'
import { insertPrimarySession } from '../repositories/index.js'
import {
  beginDelegatedTurn,
  enqueueCheckpointContinuation,
  resolveDelegatedJobIdentity,
} from './enqueue-checkpoint-continuation.js'

const deps = { logger: pino({ level: 'silent' }) }
const touched: string[] = []

afterEach(() => {
  for (const id of touched.splice(0)) clearPendingCheckpoint(id)
})

function seedUserAndWorkspace(db: Database) {
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
  return { user, workspace }
}

function seedPrimary(db: Database, userId: string, workspaceId: string | null, scope: 'workspace' | 'spawned') {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    scope,
    currentSdkSessionId: 'sdk-head-1',
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('enqueueCheckpointContinuation', () => {
  it('a workspace job resolves its identity to the workspace primary and enqueues a same-shape follow-up', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const primary = seedPrimary(db, user.id, workspace.id, 'workspace')
      touched.push(primary.id)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'reconcile the June receipts',
        permissionMode: 'ask',
        model: 'claude-opus-5',
        thinkingEffort: 'high',
        origin: { channelId: 'ch-1', externalSenderId: 'tg-7', externalChatContextId: 'chat-9' },
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())!
      expect(resolveDelegatedJobIdentity(db, claimed)).toBe(primary.id)
      completeDelegationJob(db, claimed.id, 'stopping here to swap', new Date())

      // The model checkpointed during the turn.
      markPendingCheckpoint(primary.id, 'sum the July receipts')
      const followUpId = enqueueCheckpointContinuation(db, claimed, deps)
      expect(followUpId).not.toBeNull()
      const followUp = findDelegationJobById(db, followUpId!)!
      expect(followUp.status).toBe('pending')
      expect(followUp.workspaceId).toBe(workspace.id)
      expect(followUp.workspacePath).toBe(workspace.path)
      expect(followUp.workspaceName).toBe(workspace.name)
      expect(followUp.threadId).toBe(claimed.threadId)
      expect(followUp.parentSessionId).toBe('global-sdk-1')
      expect(followUp.permissionMode).toBe('ask')
      expect(followUp.model).toBe('claude-opus-5')
      expect(followUp.thinkingEffort).toBe('high')
      expect(followUp.originChannelId).toBe('ch-1')
      expect(followUp.originExternalSenderId).toBe('tg-7')
      expect(followUp.originExternalChatContextId).toBe('chat-9')
      // The SHORT anchor row (the runners persist task text verbatim) — the
      // fuller instruction is the run's steer, keyed off the remembered mark.
      expect(followUp.taskText).toBe('Continuing after patching context — next: sum the July receipts')
      expect(takeContinuationJob(followUp.id)?.nextStep).toBe('sum the July receipts')
      // Consumed exactly once — a second call enqueues nothing.
      expect(peekPendingCheckpoint(primary.id)).toBeNull()
      expect(enqueueCheckpointContinuation(db, claimed, deps)).toBeNull()
    })
  })

  it('a session job IS its target primary — the follow-up keeps the session target + run cwd + requester', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      const spawned = seedPrimary(db, user.id, null, 'spawned')
      touched.push(spawned.id)
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        targetPrimarySessionId: spawned.id,
        runCwdPath: '/tmp/vynel/hidden',
        taskText: 'draft the mailing',
        requesterWorkspaceId: workspace.id,
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())!
      expect(resolveDelegatedJobIdentity(db, claimed)).toBe(spawned.id)
      completeDelegationJob(db, claimed.id, 'checkpointed', new Date())
      markPendingCheckpoint(spawned.id, 'send the mailing')
      const followUp = findDelegationJobById(db, enqueueCheckpointContinuation(db, claimed, deps)!)!
      expect(followUp.targetPrimarySessionId).toBe(spawned.id)
      expect(followUp.workspaceId).toBeNull()
      expect(followUp.workspacePath).toBe('/tmp/vynel/hidden')
      expect(followUp.requesterWorkspaceId).toBe(workspace.id)
      expect(followUp.threadId).toBe(claimed.threadId)
      expect(followUp.taskText).toBe('Continuing after patching context — next: send the mailing')
    })
  })

  it('an AGENT-RUN job continues as an agent-run follow-up on the colleague — its workspace is the grounding, never the identity', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      // The colleague's continuing identity, grounded in the workspace.
      const colleague = seedPrimary(db, user.id, workspace.id, 'spawned')
      touched.push(colleague.id)
      enqueueAgentRun(db, {
        userId: user.id,
        parentSessionId: 'chat-sdk-1',
        agentSlug: 'researcher',
        agentName: 'Nova',
        taskText: '@researcher dig into the July numbers',
        workspaceId: workspace.id,
        runCwdPath: workspace.path,
        targetPrimarySessionId: colleague.id,
        requesterWorkspaceId: workspace.id,
        permissionMode: 'ask',
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())!
      expect(claimed.jobKind).toBe('agent-run')
      expect(resolveDelegatedJobIdentity(db, claimed)).toBe(colleague.id)
      completeDelegationJob(db, claimed.id, 'checkpointed', new Date())
      markPendingCheckpoint(colleague.id, 'compare against June')
      const followUp = findDelegationJobById(db, enqueueCheckpointContinuation(db, claimed, deps)!)!
      expect(followUp.jobKind).toBe('agent-run')
      expect(followUp.agentSlug).toBe('researcher')
      expect(followUp.workspaceName).toBe('Nova')
      expect(followUp.workspaceId).toBe(workspace.id)
      expect(followUp.workspacePath).toBe(workspace.path)
      expect(followUp.targetPrimarySessionId).toBe(colleague.id)
      expect(followUp.requesterWorkspaceId).toBe(workspace.id)
      expect(followUp.permissionMode).toBe('ask')
      expect(followUp.threadId).toBe(claimed.threadId)
      expect(followUp.taskText).toBe('Continuing after patching context — next: compare against June')
      // A legacy agent-run row without a stamped target has no row-derived
      // identity (its workspace is the grounding) — the runner passes the
      // colleague it resolved.
      expect(resolveDelegatedJobIdentity(db, { ...claimed, targetPrimarySessionId: null })).toBeNull()
    })
  })

  it('nothing pending → nothing enqueued; a workspace without a primary yet has no identity', async () => {
    await withTestDatabase((db) => {
      const { user, workspace } = seedUserAndWorkspace(db)
      enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'first task ever',
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())!
      expect(resolveDelegatedJobIdentity(db, claimed)).toBeNull()
      expect(enqueueCheckpointContinuation(db, claimed, deps)).toBeNull()
      // Nothing else was queued.
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })

  it('a NOTE never continues as work — its checkpoint is dropped', async () => {
    await withTestDatabase((db) => {
      const { user } = seedUserAndWorkspace(db)
      const spawned = seedPrimary(db, user.id, null, 'spawned')
      touched.push(spawned.id)
      enqueueNoteDelivery(db, {
        userId: user.id,
        senderSessionId: 'peer-sdk-1',
        senderLabel: 'A peer',
        target: { kind: 'session', targetPrimarySessionId: spawned.id, runCwdPath: '/tmp/vynel/hidden' },
        noteBody: 'FYI: the mailing went out',
      })
      const claimed = claimNextPendingDelegationJob(db, new Date())!
      expect(claimed.jobKind).toBe('note')
      markPendingCheckpoint(spawned.id, 'should never run')
      expect(enqueueCheckpointContinuation(db, claimed, deps)).toBeNull()
      expect(peekPendingCheckpoint(spawned.id)).toBeNull()
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()
    })
  })

  it('holds the runaway cap and resets on a genuine job start (dropping a stale checkpoint)', async () => {
    await withTestDatabase((db) => {
      const { user } = seedUserAndWorkspace(db)
      const spawned = seedPrimary(db, user.id, null, 'spawned')
      touched.push(spawned.id)
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        targetPrimarySessionId: spawned.id,
        runCwdPath: '/tmp/vynel/hidden',
        taskText: 'a long task',
      })
      let job = claimNextPendingDelegationJob(db, new Date())!
      expect(beginDelegatedTurn(db, job, deps)).toEqual({ continuation: null })
      // Every turn checkpoints: the follow-ups chain up to the cap, then stop.
      // Driven exactly like the tick — `beginDelegatedTurn` on EVERY claim,
      // which must NOT reset the guard for a follow-up (it continues).
      for (let round = 0; round < MAX_CONSECUTIVE_CONTINUATIONS; round += 1) {
        completeDelegationJob(db, job.id, 'checkpointed', new Date())
        markPendingCheckpoint(spawned.id, `step ${round + 1}`)
        const followUpId = enqueueCheckpointContinuation(db, job, deps)
        expect(followUpId).not.toBeNull()
        job = claimNextPendingDelegationJob(db, new Date())!
        expect(job.id).toBe(followUpId)
        expect(beginDelegatedTurn(db, job, deps).continuation?.nextStep).toBe(`step ${round + 1}`)
      }
      completeDelegationJob(db, job.id, 'checkpointed again', new Date())
      markPendingCheckpoint(spawned.id, 'one too many')
      expect(enqueueCheckpointContinuation(db, job, deps)).toBeNull()
      expect(claimNextPendingDelegationJob(db, new Date())).toBeNull()

      // A genuine job on the same identity: the guard resets and a stale
      // checkpoint is dropped before the turn runs.
      markPendingCheckpoint(spawned.id, 'left behind')
      enqueueSessionDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sdk-1',
        targetPrimarySessionId: spawned.id,
        runCwdPath: '/tmp/vynel/hidden',
        taskText: 'a new task from the user',
      })
      const genuine = claimNextPendingDelegationJob(db, new Date())!
      beginDelegatedTurn(db, genuine, deps)
      expect(peekPendingCheckpoint(spawned.id)).toBeNull()
      completeDelegationJob(db, genuine.id, 'checkpointed', new Date())
      markPendingCheckpoint(spawned.id, 'continue the new task')
      expect(enqueueCheckpointContinuation(db, genuine, deps)).not.toBeNull()
    })
  })
})

// `resolveVoiceRequesterOfJob` + its `resolveJobReportRequester` consumer
// (voice-requester routing) — real SQLite. Proves the derivation: a job whose
// asker segment is the user's own scope-'voice' row resolves the VOICE
// requester; every other shape keeps the shipped workspace/global resolution.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import { getOrCreateContinuingSession } from '../continuity/index.js'
import { resolveVoiceRequesterOfJob } from './resolve-voice-requester.js'
import { resolveJobReportRequester } from './enqueue-job-report-delivery.js'

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

/** A recorded voice segment (scope 'voice', hidden) — the asker's stamp. */
function seedVoiceSegment(db: Database, userId: string, sessionId: string) {
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Voice conversation',
      visibility: 'hidden',
      scope: 'voice',
    }),
  )
}

describe('resolveVoiceRequesterOfJob', () => {
  it('a job whose asker segment is the user-owned voice segment resolves the live voice primary', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const voicePrimary = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'voice',
      })
      seedVoiceSegment(db, user.id, 'voice-seg-1')

      const resolved = resolveVoiceRequesterOfJob(db, {
        userId: user.id,
        parentSessionId: 'voice-seg-1',
        requesterWorkspaceId: null,
      })
      expect(resolved?.voicePrimarySessionId).toBe(voicePrimary.id)
    })
  })

  it('a stamped requester workspace always wins — never voice', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await getOrCreateContinuingSession(db, { userId: user.id, scope: 'voice' })
      seedVoiceSegment(db, user.id, 'voice-seg-2')

      expect(
        resolveVoiceRequesterOfJob(db, {
          userId: user.id,
          parentSessionId: 'voice-seg-2',
          requesterWorkspaceId: randomUUID(),
        }),
      ).toBeNull()
    })
  })

  it('a missing, foreign, or non-voice asker segment resolves null (the global fallback stands)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      await getOrCreateContinuingSession(db, { userId: user.id, scope: 'voice' })
      seedVoiceSegment(db, stranger.id, 'stranger-voice-seg')
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'global-seg-1',
          userId: user.id,
          workspaceId: null,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Global brain',
          visibility: 'hidden',
        }),
      )

      const base = { userId: user.id, requesterWorkspaceId: null }
      expect(resolveVoiceRequesterOfJob(db, { ...base, parentSessionId: 'missing' })).toBeNull()
      expect(
        resolveVoiceRequesterOfJob(db, { ...base, parentSessionId: 'stranger-voice-seg' }),
      ).toBeNull()
      expect(
        resolveVoiceRequesterOfJob(db, { ...base, parentSessionId: 'global-seg-1' }),
      ).toBeNull()
    })
  })

  it('no live voice thread resolves null even off a genuine voice segment', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedVoiceSegment(db, user.id, 'voice-seg-3')

      expect(
        resolveVoiceRequesterOfJob(db, {
          userId: user.id,
          parentSessionId: 'voice-seg-3',
          requesterWorkspaceId: null,
        }),
      ).toBeNull()
    })
  })
})

describe('resolveJobReportRequester (the voice branch)', () => {
  it('a voice-asked task reports to the VOICE thread; a workspace-asked one keeps its workspace', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const voicePrimary = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'voice',
      })
      seedVoiceSegment(db, user.id, 'voice-seg-4')

      const voiceAskedJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'voice-seg-4',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'check the backlog',
      })
      const workspaceAskedJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'ws-seg-1',
        requesterWorkspaceId: workspace.id,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'check the backlog',
      })

      const voiceAsked = resolveJobReportRequester(db, findDelegationJobById(db, voiceAskedJobId)!)
      expect(voiceAsked).toEqual({ kind: 'voice', voicePrimarySessionId: voicePrimary.id })

      const workspaceAsked = resolveJobReportRequester(
        db,
        findDelegationJobById(db, workspaceAskedJobId)!,
      )
      expect(workspaceAsked.kind).toBe('workspace-primary')
    })
  })
})

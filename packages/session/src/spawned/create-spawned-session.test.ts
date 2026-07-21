// Integration tests for `createSpawnedSession` + `findSpawnedSessionBySegmentId`
// (session-library Slice ④) — real SQLite, fake provider. Proves create =
// primed SDK session (the purpose is the seed) + a scope-'spawned' primary
// linked to it + the LISTED named first segment; MANY per user is allowed
// (no liveness unique index for 'spawned' — deliberate).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { StartChatSessionInput } from '@vynel/providers'
import { findChatSessionById } from '@vynel/chat/repositories'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import * as primarySessionsRepository from '../repositories/index.js'
import { getOrCreatePrimarySession } from '../continuity/index.js'
import { createSpawnedSession } from './create-spawned-session.js'
import { findSpawnedSessionBySegmentId } from './find-spawned-session-by-segment.js'

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

describe('createSpawnedSession', () => {
  it('primes the SDK session with the purpose, creates the linked spawned primary + the listed named segment', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const primingInputs: StartChatSessionInput[] = []

      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({
          seededSessionId: 'sdk-spawned-1',
          startChatSessionInputs: primingInputs,
        }),
        {
          userId: user.id,
          name: 'Research: pricing pages',
          purpose: 'Compare the pricing pages of our three competitors.',
          workspacePath: '/tmp/vynel/global-root',
        },
      )

      // The priming turn ran in the given cwd with the purpose as the seed.
      expect(primingInputs).toHaveLength(1)
      expect(primingInputs[0]!.workspacePath).toBe('/tmp/vynel/global-root')
      expect(primingInputs[0]!.userMessageText).toContain(
        'Compare the pricing pages of our three competitors.',
      )

      // The continuing identity: scope 'spawned', global-grounded, linked.
      const primary = primarySessionsRepository.findPrimarySessionById(
        db,
        created.primarySessionId,
      )
      expect(primary?.scope).toBe('spawned')
      expect(primary?.workspaceId).toBeNull()
      expect(primary?.currentSdkSessionId).toBe('sdk-spawned-1')

      // The listed, named first segment.
      expect(created.sessionId).toBe('sdk-spawned-1')
      const segment = findChatSessionById(db, 'sdk-spawned-1')
      expect(segment?.title).toBe('Research: pricing pages')
      expect(segment?.visibility).toBe('listed')
      expect(segment?.scope).toBe('spawned')
    })
  })

  it('grounds a WORKSPACE-created session in its workspace (Slice ④b): primary + segment carry the id, cwd = the workspace path', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const now = new Date()
      const workspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'personal',
        path: `/tmp/vynel/acme-${randomUUID()}`,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const primingInputs: StartChatSessionInput[] = []

      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({
          seededSessionId: 'sdk-ws-spawned',
          startChatSessionInputs: primingInputs,
        }),
        {
          userId: user.id,
          name: 'Acme research',
          purpose: 'Dig into the Acme backlog.',
          workspacePath: workspace.path,
          workspaceId: workspace.id,
        },
      )

      // The priming turn ran in the WORKSPACE's ground.
      expect(primingInputs[0]!.workspacePath).toBe(workspace.path)

      // Primary AND segment carry the creating workspace.
      const primary = primarySessionsRepository.findPrimarySessionById(
        db,
        created.primarySessionId,
      )
      expect(primary?.scope).toBe('spawned')
      expect(primary?.workspaceId).toBe(workspace.id)
      const segment = findChatSessionById(db, 'sdk-ws-spawned')
      expect(segment?.workspaceId).toBe(workspace.id)
      expect(segment?.scope).toBe('spawned')
      expect(segment?.visibility).toBe('listed')
    })
  })

  it('allows MANY spawned sessions per user (no liveness unique index)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const first = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-a' }),
        { userId: user.id, name: 'A', purpose: 'a', workspacePath: '/tmp/x' },
      )
      const second = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-b' }),
        { userId: user.id, name: 'B', purpose: 'b', workspacePath: '/tmp/x' },
      )
      expect(first.primarySessionId).not.toBe(second.primarySessionId)
      const primaries = primarySessionsRepository
        .listPrimarySessionsForUser(db, user.id)
        .filter((row) => row.scope === 'spawned')
      expect(primaries).toHaveLength(2)
    })
  })
})

describe('findSpawnedSessionBySegmentId', () => {
  it('resolves the spawned primary from its current segment id; foreign / non-spawned handles return null', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const created = await createSpawnedSession(
        db,
        new FakeAiAgentProvider({ seededSessionId: 'sdk-owned' }),
        { userId: owner.id, name: 'Mine', purpose: 'p', workspacePath: '/tmp/x' },
      )

      const resolved = findSpawnedSessionBySegmentId(db, {
        userId: owner.id,
        sessionId: created.sessionId,
      })
      expect(resolved?.id).toBe(created.primarySessionId)

      // Not owned → null (same shape as unknown — no enumeration leak).
      expect(
        findSpawnedSessionBySegmentId(db, { userId: stranger.id, sessionId: created.sessionId }),
      ).toBeNull()
      // Unknown handle → null.
      expect(
        findSpawnedSessionBySegmentId(db, { userId: owner.id, sessionId: 'sdk-unknown' }),
      ).toBeNull()

      // A NON-spawned primary's segment never resolves here (the global brain
      // has its own tools) — link the global primary and probe with its id.
      const globalPrimary = await getOrCreatePrimarySession(db, { userId: owner.id })
      primarySessionsRepository.repointPrimarySession(db, {
        primarySessionId: globalPrimary.id,
        userId: owner.id,
        currentSdkSessionId: 'sdk-global',
      })
      expect(
        findSpawnedSessionBySegmentId(db, { userId: owner.id, sessionId: 'sdk-global' }),
      ).toBeNull()
    })
  })
})

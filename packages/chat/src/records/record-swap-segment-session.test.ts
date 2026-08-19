// Integration tests for `recordSwapSegmentSession` — real SQLite via
// `withTestDatabase`. Proves a swap-minted SDK session becomes a recorded,
// browsable chat segment that is HIDDEN from the curated sidebar (Slice 1 §2.2
// + Slice 2: the brain shows as one entry, segments hidden but recorded).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findChatSessionById,
  insertChatSession,
  listChatSessionsForWorkspace,
  updateChatSession,
} from '../repositories/index.js'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { recordSwapSegmentSession } from './record-swap-segment-session.js'
import { updateChatSessionSettings } from '../settings/update-chat-session-settings.js'

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
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('recordSwapSegmentSession (core)', () => {
  it('inserts an empty, HIDDEN chat segment (recorded + browsable) and co-commits chat.session-created', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const freshSdkSessionId = `sdk-${randomUUID()}`

      const segment = recordSwapSegmentSession(db, {
        sessionId: freshSdkSessionId,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
      })

      // The row PK is the SDK id (D15 preserved — the locked chat decision).
      expect(segment.id).toBe(freshSdkSessionId)
      // A segment starts empty — the priming exchange is NOT persisted to chat.
      expect(segment.totalMessageCount).toBe(0)
      expect(segment.isArchived).toBe(false)
      expect(segment.deletedAt).toBeNull()
      // Hidden from the curated sidebar (Slice 2).
      expect(segment.visibility).toBe('hidden')

      // It is a recorded session — persisted + browsable by id.
      const reloaded = findChatSessionById(db, freshSdkSessionId)
      expect(reloaded?.id).toBe(freshSdkSessionId)

      // It does NOT appear in the curated sidebar list…
      const listed = listChatSessionsForWorkspace(db, workspace.id)
      expect(listed.map((row) => row.id)).not.toContain(freshSdkSessionId)
      // …but IS visible with includeHidden (the future monitor's full trail).
      const all = listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true })
      expect(all.map((row) => row.id)).toContain(freshSdkSessionId)

      // Recorded on the activity log like any new session.
      const events = listOutboxEventsByType(db, CHAT_SESSION_CREATED)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as ChatSessionCreatedPayload
      expect(payload).toMatchObject({
        userId: user.id,
        workspaceId: workspace.id,
        sessionId: freshSdkSessionId,
        providerId: 'claude',
      })
      // No predecessor passed → chain head.
      expect(segment.continuedFromSessionId).toBeNull()
    })
  })

  it('stamps the continuity chain link when the superseded session is passed', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const predecessorId = `sdk-${randomUUID()}`
      const freshSdkSessionId = `sdk-${randomUUID()}`

      const segment = recordSwapSegmentSession(db, {
        sessionId: freshSdkSessionId,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        continuedFromSessionId: predecessorId,
      })

      expect(segment.continuedFromSessionId).toBe(predecessorId)
      // LOOSE ref by design — the predecessor row need not exist.
      expect(findChatSessionById(db, freshSdkSessionId)?.continuedFromSessionId).toBe(
        predecessorId,
      )
    })
  })

  it('inherits the predecessor segment’s composer settings (a swap never resets them)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const predecessorId = `sdk-${randomUUID()}`
      recordSwapSegmentSession(db, {
        sessionId: predecessorId,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
      })
      updateChatSessionSettings(db, predecessorId, {
        sessionMode: 'bypass',
        selectedModel: 'claude-opus-4-8',
        thinkingEffort: 'xhigh',
        autoBuildout: true,
      })
      // The chain's denominator, as the consumer left it on the predecessor.
      updateChatSession(db, predecessorId, { lastContextTokens: 850_000, lastContextWindow: 1_000_000 })

      const segment = recordSwapSegmentSession(db, {
        sessionId: `sdk-${randomUUID()}`,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        continuedFromSessionId: predecessorId,
      })

      expect(segment.sessionMode).toBe('bypass')
      expect(segment.selectedModel).toBe('claude-opus-4-8')
      expect(segment.thinkingEffort).toBe('xhigh')
      expect(segment.autoBuildout).toBe(true)
      // The denominator carries over; the occupancy does not (a fresh segment
      // has run nothing yet).
      expect(segment.lastContextWindow).toBe(1_000_000)
      expect(segment.lastContextTokens).toBeNull()
    })
  })

  it('a missing predecessor row leaves the settings unset (loose-ref swap)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const segment = recordSwapSegmentSession(db, {
        sessionId: `sdk-${randomUUID()}`,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        continuedFromSessionId: `sdk-${randomUUID()}`, // no such row
      })
      expect(segment.sessionMode).toBeNull()
      expect(segment.selectedModel).toBeNull()
      expect(segment.thinkingEffort).toBeNull()
      expect(segment.autoBuildout).toBeNull()
    })
  })

  it('a workspace-less swap segment (the global root) records null workspace + inherits scope global from its predecessor', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const predecessorId = `sdk-${randomUUID()}`
      insertChatSession(db, {
        ...buildNewChatSessionRow({
          sessionId: predecessorId,
          userId: user.id,
          workspaceId: null,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Global brain',
          visibility: 'hidden',
        }),
      })

      const segment = recordSwapSegmentSession(db, {
        sessionId: `sdk-${randomUUID()}`,
        userId: user.id,
        workspaceId: null,
        providerId: 'claude',
        continuedFromSessionId: predecessorId,
      })

      expect(segment.workspaceId).toBeNull()
      expect(segment.scope).toBe('global')
      expect(segment.visibility).toBe('hidden')
      expect(segment.continuedFromSessionId).toBe(predecessorId)
    })
  })

  it('a spawned or colleague continuation inherits its predecessor’s scope — never the builder’s workspace default', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const predecessorId = `sdk-${randomUUID()}`
      insertChatSession(db, {
        ...buildNewChatSessionRow({
          sessionId: predecessorId,
          userId: user.id,
          workspaceId: workspace.id,
          providerId: 'claude',
          startedAt: new Date(),
          title: 'Mailing feature',
          scope: 'spawned',
        }),
      })

      const segment = recordSwapSegmentSession(db, {
        sessionId: `sdk-${randomUUID()}`,
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        continuedFromSessionId: predecessorId,
      })

      // Same scope as the chain it continues (the mid-turn swap branch's rule);
      // the workspace-derived default would have said 'workspace'.
      expect(segment.scope).toBe('spawned')
      expect(segment.workspaceId).toBe(workspace.id)
    })
  })
})

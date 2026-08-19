// Tests for `getSessionsOverview` — chain folding, fork-B surfacing, the
// hidden-chain doorway rule, isCurrent, sort + tenancy. Real SQLite.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  insertChatMessage,
  updateChatSession,
  type NewChatSession,
} from '@vynel/chat/repositories'
import { insertApprovalRequest } from '@vynel/approvals/test-support'
import { insertAskRequest, makeAskRequest } from '@vynel/asks/test-support'
import {
  getOrCreateContinuingSession,
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import {
  getSessionsOverview,
  getVoiceChatOverviewEntry,
  countSessionsOverview,
} from './get-sessions-overview.js'

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

function makeWorkspace(userId: string, name = 'Acme') {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeSession(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date('2026-07-01T00:00:00Z')
  return {
    id: `sdk-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    visibility: 'listed',
    scope: 'workspace',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeMessage(sessionId: string, role: 'user' | 'assistant', startedAt: Date) {
  return {
    id: randomUUID(),
    sessionId,
    role,
    body: 'hello',
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt,
    completedAt: startedAt,
    createdAt: startedAt,
  }
}

describe('getSessionsOverview', () => {
  it('folds a continuity chain into ONE entry keyed by its newest segment', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))

      const head = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Fix the build',
          model: 'claude-opus-4-8',
          lastContextTokens: 170_000,
          lastMessageAt: new Date('2026-07-01T10:00:00Z'),
        }),
      )
      const tail = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Continued conversation',
          visibility: 'hidden',
          model: 'claude-opus-4-8',
          lastContextTokens: 12_000,
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-01T11:00:00Z'),
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      const entry = entries[0]!
      // The entry IS the conversation: newest segment's id, the real title
      // (never the swap stock title), the CURRENT occupancy, the chain inside.
      expect(entry.sessionId).toBe(tail.id)
      expect(entry.title).toBe('Fix the build')
      expect(entry.workspaceName).toBe('Acme')
      expect(entry.contextTokens).toBe(12_000)
      expect(entry.contextWindow).toBe(1_000_000) // opus-4-8 per resolveContextWindow
      expect(entry.segments.map((segment) => segment.sessionId)).toEqual([head.id, tail.id])
      // The fork label derives from the predecessor's persisted occupancy.
      expect(entry.segments[0]!.contextTokens).toBe(170_000)
      expect(entry.segments[1]!.continuedFromSessionId).toBe(head.id)
    })
  })

  it('surfaces the all-hidden GLOBAL chain as the "Assistant" entry (fork B)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      insertChatSession(
        db,
        makeSession(user.id, null, {
          title: 'Global brain',
          scope: 'global',
          visibility: 'hidden',
          lastContextTokens: 40_000,
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        scope: 'global',
        title: 'Assistant',
        workspaceId: null,
        workspaceName: null,
        contextTokens: 40_000,
      })
    })
  })

  it('skips a WORKSPACE chain hidden end to end (no user-facing doorway)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(
        db,
        makeSession(user.id, ws.id, { visibility: 'hidden', title: 'Continued conversation' }),
      )

      expect(getSessionsOverview(db, { userId: user.id })).toHaveLength(0)
    })
  })

  it('lists a SPAWNED session as its own entry — scope spawned, title = the name, no workspace (Slice ④)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      insertChatSession(
        db,
        makeSession(user.id, null, {
          id: 'sdk-spawned-1',
          title: 'Research: pricing',
          scope: 'spawned',
          visibility: 'listed',
          totalMessageCount: 0,
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      const spawned = entries.find((entry) => entry.sessionId === 'sdk-spawned-1')
      expect(spawned?.scope).toBe('spawned')
      expect(spawned?.title).toBe('Research: pricing')
      expect(spawned?.workspaceId).toBeNull()
      expect(spawned?.segments).toHaveLength(1)
    })
  })

  it('marks the segment a live primary points at as isCurrent', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: ws.id })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: session.id,
      })

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries[0]!.segments[0]!.isCurrent).toBe(true)
    })
  })

  it('sorts by last use (newest first) and never leaks another tenant', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const otherUser = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const otherWs = insertWorkspace(db, makeWorkspace(otherUser.id))

      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Older',
          lastMessageAt: new Date('2026-07-01T09:00:00Z'),
        }),
      )
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Newer',
          lastMessageAt: new Date('2026-07-02T09:00:00Z'),
        }),
      )
      insertChatSession(db, makeSession(otherUser.id, otherWs.id, { title: 'Not yours' }))

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries.map((entry) => entry.title)).toEqual(['Newer', 'Older'])
    })
  })

  it('CORRUPTION: two children claiming one parent — the NEWEST wins the chain (the live segment survives)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const head = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Original',
          lastMessageAt: new Date('2026-07-01T09:00:00Z'),
        }),
      )
      // A crashed double swap: two segments claim the same predecessor.
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Stale twin',
          visibility: 'hidden',
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-01T10:00:00Z'),
        }),
      )
      const liveTwin = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Continued conversation',
          visibility: 'hidden',
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-01T11:00:00Z'),
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      // The chain walks head → the NEWEST claimant; the stale twin drops.
      expect(entries[0]!.sessionId).toBe(liveTwin.id)
      expect(entries[0]!.segments).toHaveLength(2)
    })
  })

  it('CORRUPTION: a cycle terminates the fold (silent omission, no hang)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      // A ↔ B: both have in-window parents, so neither is a head — the pair
      // silently drops; an unrelated healthy session still lists.
      const a = insertChatSession(db, makeSession(user.id, ws.id, { title: 'Cycle A' }))
      const b = insertChatSession(
        db,
        makeSession(user.id, ws.id, { title: 'Cycle B', continuedFromSessionId: a.id }),
      )
      updateChatSession(db, a.id, { continuedFromSessionId: b.id })
      insertChatSession(db, makeSession(user.id, ws.id, { title: 'Healthy' }))

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries.map((entry) => entry.title)).toEqual(['Healthy'])
    })
  })

  it('a pruned predecessor makes the surviving segment a chain head (no crash)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const orphan = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Survivor',
          continuedFromSessionId: `sdk-${randomUUID()}`, // predecessor purged
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      expect(entries[0]!.sessionId).toBe(orphan.id)
      expect(entries[0]!.segments).toHaveLength(1)
    })
  })
})

describe('getSessionsOverview — statusFacts (Move 3)', () => {
  it('carries the set trio, the latest-assistant error, and the chain-wide approval count', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))

      // A two-segment chain: the error + a pending approval live on the OLD
      // segment, the set trio on the tail (where copy-forward keeps it).
      const head = insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-old' }))
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'sdk-new',
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-02T00:00:00Z'),
        }),
      )
      updateChatSession(db, 'sdk-new', {
        status: 'needs_input',
        statusNote: 'Pick a variant.',
        statusSetAt: new Date('2026-07-02T01:00:00Z'),
      })
      insertChatMessage(db, {
        id: randomUUID(),
        sessionId: 'sdk-new',
        role: 'user',
        body: 'go on',
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: null,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date('2026-07-02T00:30:00Z'),
        completedAt: new Date('2026-07-02T00:30:00Z'),
        createdAt: new Date('2026-07-02T00:30:00Z'),
      })
      insertChatMessage(db, {
        id: randomUUID(),
        sessionId: 'sdk-new',
        role: 'assistant',
        body: '',
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: null,
        errorCode: 'error_during_execution',
        errorMessage: "You've hit your session limit · resets 2:20pm",
        startedAt: new Date('2026-07-02T00:31:00Z'),
        completedAt: new Date('2026-07-02T00:31:00Z'),
        createdAt: new Date('2026-07-02T00:31:00Z'),
      })
      // Pending approval on the OLD segment — chains count across segments.
      insertApprovalRequest(db, {
        id: randomUUID(),
        providerApprovalId: randomUUID(),
        userId: user.id,
        workspaceId: ws.id,
        sessionId: 'sdk-old',
        parentMessageId: 'm-1',
        toolUseId: 'tu-1',
        toolName: 'Bash',
        actionKind: 'shell-command',
        toolInput: { command: 'rm -rf' },
        status: 'pending',
        timeoutMs: 60000,
        requestedAt: new Date('2026-07-02T00:20:00Z'),
        resolvedAt: null,
      })
      // A RESOLVED approval must not count.
      insertApprovalRequest(db, {
        id: randomUUID(),
        providerApprovalId: randomUUID(),
        userId: user.id,
        workspaceId: ws.id,
        sessionId: 'sdk-new',
        parentMessageId: 'm-2',
        toolUseId: 'tu-2',
        toolName: 'Write',
        actionKind: 'shell-command',
        toolInput: {},
        status: 'resolved',
        timeoutMs: 60000,
        requestedAt: new Date('2026-07-02T00:21:00Z'),
        resolvedAt: new Date('2026-07-02T00:22:00Z'),
      })

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.sessionId).toBe('sdk-new')
      expect(entry?.statusFacts).toEqual({
        setStatus: 'needs_input',
        statusNote: 'Pick a variant.',
        statusSetAt: '2026-07-02T01:00:00.000Z',
        lastError: {
          code: 'error_during_execution',
          message: "You've hit your session limit · resets 2:20pm",
          at: '2026-07-02T00:31:00.000Z',
        },
        pendingApprovalCount: 1,
        pendingAskCount: 0,
        latestUserMessageAt: '2026-07-02T00:30:00.000Z',
      })
    })
  })

  it('a quiet conversation reports empty facts', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id))
      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.statusFacts).toEqual({
        setStatus: null,
        statusNote: null,
        statusSetAt: null,
        lastError: null,
        pendingApprovalCount: 0,
        pendingAskCount: 0,
        latestUserMessageAt: null,
      })
    })
  })

  // The swap bug (review catch, 2026-08-17): the facts used to be read off the
  // TAIL alone, and a swap segment carries no messages — so "the user never
  // spoke" made every superseded status stand again. The most swap-prone
  // conversation in the app is the assistant thread, whose entry feeds the
  // shell's global light, so a stale green `completed` (or red `problem`) with
  // an old note was exactly the lie this feature exists to prevent.
  it('a swap does NOT resurrect a superseded status — facts span the whole chain', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const head = insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-a' }))
      // The assistant said "done" …
      updateChatSession(db, head.id, {
        status: 'completed',
        statusNote: 'All three drafts are in your inbox.',
        statusSetAt: new Date('2026-07-01T10:00:00Z'),
      })
      // … then the user asked for something else (this supersedes it) …
      insertChatMessage(db, makeMessage('sdk-a', 'user', new Date('2026-07-01T11:00:00Z')))
      // … and the conversation swapped onto a fresh, message-less segment that
      // inherited the trio (copy-forward — deleting that would lose a standing
      // `problem`, so the fix is the READ, not the copy).
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'sdk-b',
          continuedFromSessionId: 'sdk-a',
          status: 'completed',
          statusNote: 'All three drafts are in your inbox.',
          statusSetAt: new Date('2026-07-01T10:00:00Z'),
          lastMessageAt: new Date('2026-07-01T12:00:00Z'),
        }),
      )

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.sessionId).toBe('sdk-b')
      // The anchor survives the swap, so the set state stays superseded.
      expect(entry?.statusFacts.latestUserMessageAt).toBe('2026-07-01T11:00:00.000Z')
    })
  })

  // A conversation parked on `ask_user` used to be indistinguishable from one
  // that was working: the turn blocks inside the stream, so its activity entry
  // stays live and the ladder rendered `running`. Counting the ask is what
  // lets `needs_input` outrank it.
  it('a pending ask on the conversation counts', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-a' }))
      insertAskRequest(db, makeAskRequest(user.id, ws.id, { sessionId: 'sdk-a' }))

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.statusFacts.pendingAskCount).toBe(1)
    })
  })

  it('a resolved ask, or one on another conversation, does not count', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-a' }))
      insertAskRequest(
        db,
        makeAskRequest(user.id, ws.id, {
          sessionId: 'sdk-a',
          status: 'answered',
          resolvedAt: new Date(),
        }),
      )
      insertAskRequest(db, makeAskRequest(user.id, ws.id, { sessionId: 'someone-elses' }))
      // A channel turn with no watching conversation records no session at all.
      insertAskRequest(db, makeAskRequest(user.id, null))

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.statusFacts.pendingAskCount).toBe(0)
    })
  })

  it('an ask raised before a swap still counts on the chain', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-a' }))
      insertAskRequest(db, makeAskRequest(user.id, ws.id, { sessionId: 'sdk-a' }))
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'sdk-b',
          continuedFromSessionId: 'sdk-a',
          lastMessageAt: new Date('2026-07-01T12:00:00Z'),
        }),
      )

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.sessionId).toBe('sdk-b')
      expect(entry?.statusFacts.pendingAskCount).toBe(1)
    })
  })

  it('an error a MID-TURN swap left on the predecessor stays visible', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-a' }))
      insertChatMessage(db, makeMessage('sdk-a', 'user', new Date('2026-07-01T11:00:00Z')))
      insertChatMessage(db, {
        ...makeMessage('sdk-a', 'assistant', new Date('2026-07-01T11:01:00Z')),
        body: '',
        errorCode: 'error_during_execution',
        errorMessage: "You've hit your session limit · resets 2:20pm",
      })
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'sdk-b',
          continuedFromSessionId: 'sdk-a',
          lastMessageAt: new Date('2026-07-01T12:00:00Z'),
        }),
      )

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.statusFacts.lastError?.message).toBe(
        "You've hit your session limit · resets 2:20pm",
      )
    })
  })

  it('a later successful reply anywhere in the chain clears the error', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'sdk-a' }))
      insertChatMessage(db, {
        ...makeMessage('sdk-a', 'assistant', new Date('2026-07-01T11:01:00Z')),
        body: '',
        errorCode: 'error_during_execution',
        errorMessage: 'limit',
      })
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'sdk-b',
          continuedFromSessionId: 'sdk-a',
          lastMessageAt: new Date('2026-07-01T12:00:00Z'),
        }),
      )
      insertChatMessage(db, makeMessage('sdk-b', 'assistant', new Date('2026-07-01T12:01:00Z')))

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry?.statusFacts.lastError).toBeNull()
    })
  })
})

// ── Paging + scope (2026-08-17) ────────────────────────────────────
// The library used to show the newest 50 and say nothing about the rest, so
// older conversations were unreachable from the UI. Paging is what fixes it;
// the scope has to be applied BEFORE the cap or the pages come back sparse and
// the scroll stalls with plenty left.
describe('paging', () => {
  function seedConversations(db: Parameters<typeof getSessionsOverview>[0], count: number) {
    const user = insertUser(db, makeUser())
    const ws = insertWorkspace(db, makeWorkspace(user.id))
    for (let index = 0; index < count; index += 1) {
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: `sdk-${String(index).padStart(3, '0')}`,
          title: `Conversation ${index}`,
          // Newest first: a HIGHER index is more recent.
          lastMessageAt: new Date(Date.parse('2026-07-01T00:00:00Z') + index * 60_000),
        }),
      )
    }
    return { user, ws }
  }

  it('defaults to the newest 50 — the shipped behaviour, unchanged', async () => {
    await withTestDatabase((db) => {
      const { user } = seedConversations(db, 60)
      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(50)
      expect(entries[0]?.title).toBe('Conversation 59')
    })
  })

  it('offset walks past the first page and reaches the oldest rows', async () => {
    await withTestDatabase((db) => {
      const { user } = seedConversations(db, 60)
      const secondPage = getSessionsOverview(db, { userId: user.id, limit: 50, offset: 50 })
      // 10 left — a SHORT page, which is how the client knows it is the last.
      expect(secondPage).toHaveLength(10)
      expect(secondPage[0]?.title).toBe('Conversation 9')
      expect(secondPage.at(-1)?.title).toBe('Conversation 0')
    })
  })

  it('pages do not overlap or skip', async () => {
    await withTestDatabase((db) => {
      const { user } = seedConversations(db, 25)
      const ids = [
        ...getSessionsOverview(db, { userId: user.id, limit: 10, offset: 0 }),
        ...getSessionsOverview(db, { userId: user.id, limit: 10, offset: 10 }),
        ...getSessionsOverview(db, { userId: user.id, limit: 10, offset: 20 }),
      ].map((entry) => entry.sessionId)
      expect(ids).toHaveLength(25)
      expect(new Set(ids).size).toBe(25)
    })
  })

  it('scope curates BEFORE the cap, so a page is dense', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const room = insertWorkspace(db, makeWorkspace(user.id, 'Room'))
      const other = insertWorkspace(db, makeWorkspace(user.id, 'Other'))
      // 30 in the other room are NEWER, so an unscoped first page of 5 would
      // contain none of the room's — the sparse-page failure this prevents.
      for (let index = 0; index < 3; index += 1) {
        insertChatSession(
          db,
          makeSession(user.id, room.id, {
            title: `Room ${index}`,
            lastMessageAt: new Date(Date.parse('2026-07-01T00:00:00Z') + index * 1000),
          }),
        )
      }
      for (let index = 0; index < 30; index += 1) {
        insertChatSession(
          db,
          makeSession(user.id, other.id, {
            title: `Other ${index}`,
            lastMessageAt: new Date(Date.parse('2026-07-02T00:00:00Z') + index * 1000),
          }),
        )
      }

      const page = getSessionsOverview(db, {
        userId: user.id,
        scope: { workspaceId: room.id },
        limit: 5,
      })
      expect(page).toHaveLength(3)
      expect(page.every((entry) => entry.workspaceId === room.id)).toBe(true)
    })
  })
})

describe('countSessionsOverview', () => {
  it('counts every conversation past the page cap', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      for (let index = 0; index < 60; index += 1) {
        insertChatSession(db, makeSession(user.id, ws.id, { title: `C${index}` }))
      }
      // The badge used to be the list's length, so it froze at the cap.
      expect(getSessionsOverview(db, { userId: user.id })).toHaveLength(50)
      expect(countSessionsOverview(db, { userId: user.id })).toBe(60)
    })
  })

  it('counts a scope the same way the list curates it', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const room = insertWorkspace(db, makeWorkspace(user.id, 'Room'))
      const other = insertWorkspace(db, makeWorkspace(user.id, 'Other'))
      insertChatSession(db, makeSession(user.id, room.id))
      insertChatSession(db, makeSession(user.id, room.id))
      insertChatSession(db, makeSession(user.id, other.id))

      expect(countSessionsOverview(db, { userId: user.id, scope: { workspaceId: room.id } })).toBe(2)
      expect(
        getSessionsOverview(db, { userId: user.id, scope: { workspaceId: room.id } }),
      ).toHaveLength(2)
    })
  })

  // A chain is why no `chat_sessions` row count can answer this — the count
  // and the list must fold identically or the badge disagrees with the rows.
  it('counts a continuity chain as ONE conversation, like the list', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'chain-a' }))
      insertChatSession(
        db,
        makeSession(user.id, ws.id, { id: 'chain-b', continuedFromSessionId: 'chain-a' }),
      )
      expect(countSessionsOverview(db, { userId: user.id })).toBe(1)
    })
  })
})

// ── The continuing identity on every entry (session-hardening D1) ──────
// The activity feed stamps `primarySessionId` on the turns it announces; the
// entry has to carry the same value or the client is back to inferring
// identity from a null session id — the bug that let the Global chat render
// the spoken thread.
describe('entry identity', () => {
  it('carries the primary that points at the chain head', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: ws.id })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: session.id,
      })

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry!.primarySessionId).toBe(primary.id)
    })
  })

  it('is null for a chain no live primary points at', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id))

      const [entry] = getSessionsOverview(db, { userId: user.id })
      expect(entry!.primarySessionId).toBeNull()
    })
  })
})

// ── The voice thread (session-hardening D2) ───────────────────────────
// The fold admits the spoken chain so it HAS status facts; this read drops it
// again, because the same answer is the `list_sessions` tool's. The Voice chat
// surface reads it through its own door.
describe('the voice thread', () => {
  function insertVoiceSegment(db: Parameters<typeof insertChatSession>[0], userId: string) {
    return insertChatSession(
      db,
      makeSession(userId, null, {
        scope: 'voice',
        visibility: 'hidden',
        title: 'Voice conversation',
        lastMessageAt: new Date('2026-07-03T09:00:00Z'),
      }),
    )
  }

  it('never rides the shared list — unscoped, scoped, or counted', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(db, makeSession(user.id, ws.id, { title: 'Fix the build' }))
      insertVoiceSegment(db, user.id)

      expect(getSessionsOverview(db, { userId: user.id }).map((e) => e.scope)).toEqual([
        'workspace',
      ])
      expect(
        getSessionsOverview(db, { userId: user.id, scope: { workspaceId: null } }),
      ).toHaveLength(0)
      expect(countSessionsOverview(db, { userId: user.id })).toBe(1)
    })
  })

  it('is served as ONE entry with its own status facts', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const head = insertVoiceSegment(db, user.id)
      // A failed spoken turn: the assistant row carries the error the status
      // ladder turns into `problem` — invisible everywhere before D2.
      insertChatMessage(db, {
        ...makeMessage(head.id, 'assistant', new Date('2026-07-03T09:00:00Z')),
        errorCode: 'session_limit',
        errorMessage: "You've hit your session limit",
      })
      const voicePrimary = await getOrCreateContinuingSession(db, {
        userId: user.id,
        scope: 'voice',
      })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: voicePrimary.id,
        userId: user.id,
        sdkSessionId: head.id,
      })

      const entry = getVoiceChatOverviewEntry(db, { userId: user.id })
      expect(entry?.scope).toBe('voice')
      expect(entry?.sessionId).toBe(head.id)
      expect(entry?.primarySessionId).toBe(voicePrimary.id)
      expect(entry?.statusFacts.lastError?.message).toBe("You've hit your session limit")
    })
  })

  // Both swap writers carry `scope` forward from the predecessor
  // (`record-swap-segment-session.ts:95`, `handle-session-started.ts:133`), and
  // BOTH the fold's voice branch and the list's voice wall key on the TAIL's
  // scope — so a writer that ever stopped carrying it would surface the spoken
  // conversation in `list_sessions` as an "Assistant" entry. Pinned here.
  it('folds its whole chain, hidden swap segments included, and the tail stays voice-scoped', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const head = insertVoiceSegment(db, user.id)
      insertChatSession(
        db,
        makeSession(user.id, null, {
          scope: 'voice',
          visibility: 'hidden',
          title: 'Continued conversation',
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-03T10:00:00Z'),
        }),
      )

      const entry = getVoiceChatOverviewEntry(db, { userId: user.id })
      expect(entry?.segments).toHaveLength(2)
      expect(entry?.scope).toBe('voice')
      expect(getSessionsOverview(db, { userId: user.id })).toHaveLength(0)
    })
  })

  it('is null before anything was ever spoken', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(getVoiceChatOverviewEntry(db, { userId: user.id })).toBeNull()
    })
  })
})

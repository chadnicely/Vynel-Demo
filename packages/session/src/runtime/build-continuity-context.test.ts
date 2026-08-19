// Integration tests for `buildContinuityContext` — the contextBuilder, real
// SQLite. Pins the carry's shape (identity + summary + verbatim tail + refs +
// recovery), the per-scope identity line, the tail's caps and skips, and the
// invariant that matters most: the carry is composed from the identity's OWN
// chain only — a stranger's rows, or an unrelated session's, never ride in.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { insertChatSession, insertChatMessage, type NewChatMessage } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertPrimarySession, type PrimarySessionScope } from '../repositories/index.js'
import { buildContinuityContext, DEFAULT_TAIL_MESSAGE_LIMIT } from './build-continuity-context.js'
import { markPendingCheckpoint, peekPendingCheckpoint } from '../continuity/pending-checkpoints.js'
import { listSessionChainTailMessages, resolveSessionChainOrigin } from './resolve-primary-transcript.js'

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

function makeWorkspace(userId: string, name = 'Seo') {
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

function seedPrimary(
  db: Database,
  userId: string,
  workspaceId: string | null,
  currentSdkSessionId: string,
  identity: { scope?: PrimarySessionScope; scopeRef?: string } = {},
) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    ...(identity.scope !== undefined ? { scope: identity.scope } : {}),
    ...(identity.scopeRef !== undefined ? { scopeRef: identity.scopeRef } : {}),
    currentSdkSessionId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

function seedSegment(
  db: Database,
  row: {
    sessionId: string
    userId: string
    workspaceId: string | null
    title?: string
    scope?: 'global' | 'workspace' | 'agent' | 'spawned'
    visibility?: 'listed' | 'hidden'
    continuedFrom?: string
    startedAt?: Date
  },
) {
  return insertChatSession(db, {
    ...buildNewChatSessionRow({
      sessionId: row.sessionId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      providerId: 'claude',
      startedAt: row.startedAt ?? new Date(),
      title: row.title ?? 'New session',
      ...(row.scope !== undefined ? { scope: row.scope } : {}),
      ...(row.visibility !== undefined ? { visibility: row.visibility } : {}),
    }),
    ...(row.continuedFrom !== undefined ? { continuedFromSessionId: row.continuedFrom } : {}),
  })
}

let messageClock = Date.now()
function seedMessage(
  db: Database,
  sessionId: string,
  role: 'user' | 'assistant',
  body: string,
  extra: Partial<NewChatMessage> = {},
) {
  // Strictly increasing timestamps — the tail read orders by them.
  messageClock += 1_000
  const at = new Date(messageClock)
  const message: NewChatMessage = {
    id: randomUUID(),
    sessionId,
    role,
    body,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: at,
    completedAt: at,
    createdAt: at,
    ...extra,
  }
  return insertChatMessage(db, message)
}

const SUMMARY =
  'GOAL: ship the lead finder. DONE: research written up. IN PROGRESS: picking a target area. NEXT: UK commuter towns. FACTS: Apify, $5 free credit.'

describe('buildContinuityContext', () => {
  it('composes identity + summary + verbatim tail + refs + recovery for a WORKSPACE primary', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, 'Seo'))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      seedSegment(db, { sessionId: 'seg-a', userId: user.id, workspaceId: workspace.id, visibility: 'hidden' })
      seedMessage(db, 'seg-a', 'user', 'So we are going to use apify?')
      seedMessage(db, 'seg-a', 'assistant', 'Yes — that is the plan.')

      const context = buildContinuityContext(db, {
        primarySessionId: primary.id,
        userId: user.id,
        fromSdkSessionId: 'seg-a',
        summary: SUMMARY,
      })

      expect(context.identityLine).toBe('the continuing main conversation of workspace “Seo”')
      expect(context.tailMessageCount).toBe(2)
      const { carry } = context
      // Section order: identity → summary → tail → recovery.
      const at = (needle: string) => carry.indexOf(needle)
      expect(at('IDENTITY: You are the continuing main conversation of workspace “Seo”')).toBe(0)
      expect(carry).toContain('previous session segment (seg-a)')
      expect(at('HAND-OFF SUMMARY:')).toBeGreaterThan(at('IDENTITY:'))
      expect(carry).toContain(SUMMARY)
      expect(at('LAST MESSAGES')).toBeGreaterThan(at('HAND-OFF SUMMARY:'))
      expect(carry).toContain('[user] So we are going to use apify?')
      expect(carry).toContain('[assistant] Yes — that is the plan.')
      expect(at('[user] So we')).toBeLessThan(at('[assistant] Yes'))
      expect(at('HOW TO RECOVER MORE')).toBeGreaterThan(at('LAST MESSAGES'))
      expect(carry).toContain('get_chat_session')
      expect(carry).toContain('search_memory')
      expect(carry).toContain('`session-continuity`')
      // The duty-book pointer, honest either way (§4.5) — the lookup is
      // injected so the live shelf's contents never decide this test.
      expect(carry).toContain('`whoami` tells you who you are')
      expect(carry).toContain('duty-workspace-manager')
      const unpublished = buildContinuityContext(
        db,
        { primarySessionId: primary.id, userId: user.id, fromSdkSessionId: 'seg-a', summary: SUMMARY },
        { bookExists: () => false },
      )
      expect(unpublished.carry).toContain('Your duty book is `duty-workspace-manager` — not published yet')
      const published = buildContinuityContext(
        db,
        { primarySessionId: primary.id, userId: user.id, fromSdkSessionId: 'seg-a', summary: SUMMARY },
        { bookExists: (slug) => slug === 'duty-workspace-manager' },
      )
      expect(published.carry).toContain('Your duty book `duty-workspace-manager` is on the shelf')
      expect(carry).toContain("Never mix in\n  another session's context")
    })
  })

  it('carries a pending CHECKPOINT (the next step the model named) — peeked, never consumed; absent when none is pending', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, 'Seo'))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-a')
      seedSegment(db, { sessionId: 'seg-a', userId: user.id, workspaceId: workspace.id, visibility: 'hidden' })
      const input = { primarySessionId: primary.id, userId: user.id, fromSdkSessionId: 'seg-a', summary: SUMMARY }
      expect(buildContinuityContext(db, input).carry).not.toContain('CHECKPOINT:')
      markPendingCheckpoint(db, primary.id, 'sum the July receipts')
      const { carry } = buildContinuityContext(db, input)
      const at = (needle: string) => carry.indexOf(needle)
      expect(carry).toContain('CHECKPOINT: you stopped here to swap contexts, mid-task. The next step you named: sum the July receipts')
      // Between the hand-off and the recovery instructions; still pending after.
      expect(at('CHECKPOINT:')).toBeGreaterThan(at('HAND-OFF SUMMARY:'))
      expect(at('HOW TO RECOVER MORE')).toBeGreaterThan(at('CHECKPOINT:'))
      expect(peekPendingCheckpoint(db, primary.id)?.nextStep).toBe('sum the July receipts')
    })
  })

  it('names the identity per scope: global, spawned (from its listed identity row), agent colleague (name + slug)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, 'Acme'))

      // GLOBAL — workspace-less brain.
      const globalPrimary = seedPrimary(db, user.id, null, 'g-1', { scope: 'global' })
      seedSegment(db, { sessionId: 'g-1', userId: user.id, workspaceId: null, scope: 'global', visibility: 'hidden' })
      expect(
        buildContinuityContext(db, { primarySessionId: globalPrimary.id, userId: user.id, fromSdkSessionId: 'g-1', summary: SUMMARY }).identityLine,
      ).toBe("the global assistant — the continuing conversation above all of the user's workspaces")

      // SPAWNED — its name is the LISTED origin row's title, even after a swap
      // moved the head onto a hidden "Continued conversation" segment.
      const spawnedPrimary = seedPrimary(db, user.id, workspace.id, 'sp-2', { scope: 'spawned' })
      seedSegment(db, { sessionId: 'sp-1', userId: user.id, workspaceId: workspace.id, scope: 'spawned', title: 'Mailing feature', visibility: 'listed' })
      seedSegment(db, { sessionId: 'sp-2', userId: user.id, workspaceId: workspace.id, scope: 'spawned', title: 'Continued conversation', visibility: 'hidden', continuedFrom: 'sp-1' })
      expect(
        buildContinuityContext(db, { primarySessionId: spawnedPrimary.id, userId: user.id, fromSdkSessionId: 'sp-2', summary: SUMMARY }).identityLine,
      ).toBe('the spawned session “Mailing feature”, grounded in workspace “Acme”')

      // AGENT colleague — name from its identity row + the slug; global-grounded.
      const agentPrimary = seedPrimary(db, user.id, null, 'ag-1', { scope: 'agent', scopeRef: 'reviewer' })
      seedSegment(db, { sessionId: 'ag-1', userId: user.id, workspaceId: null, scope: 'agent', title: 'Code Reviewer', visibility: 'listed' })
      expect(
        buildContinuityContext(db, { primarySessionId: agentPrimary.id, userId: user.id, fromSdkSessionId: 'ag-1', summary: SUMMARY }).identityLine,
      ).toBe('the agent colleague “Code Reviewer” (agent “reviewer”), grounded in the global scope')
    })
  })

  it('the tail is OWN-CHAIN ONLY: a stranger’s rows and an unrelated session’s rows never ride in; it walks back across the chain', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      // The owner's chain: A → B (B is the head being superseded).
      const primary = seedPrimary(db, owner.id, workspace.id, 'own-b')
      seedSegment(db, { sessionId: 'own-a', userId: owner.id, workspaceId: workspace.id })
      seedSegment(db, { sessionId: 'own-b', userId: owner.id, workspaceId: workspace.id, continuedFrom: 'own-a' })
      seedMessage(db, 'own-a', 'user', 'older fact from segment A')
      seedMessage(db, 'own-b', 'user', 'newest fact from segment B')
      // Unrelated: the owner's OTHER session, and a stranger's session — both
      // must be invisible to this identity's carry.
      seedSegment(db, { sessionId: 'own-other', userId: owner.id, workspaceId: workspace.id })
      seedMessage(db, 'own-other', 'user', 'a different conversation of the same user')
      seedSegment(db, { sessionId: 'theirs', userId: stranger.id, workspaceId: null, continuedFrom: 'own-b' })
      seedMessage(db, 'theirs', 'user', 'a stranger typed this')

      const { carry, tailMessageCount } = buildContinuityContext(db, {
        primarySessionId: primary.id,
        userId: owner.id,
        fromSdkSessionId: 'own-b',
        summary: SUMMARY,
      })

      expect(tailMessageCount).toBe(2)
      expect(carry).toContain('older fact from segment A')
      expect(carry).toContain('newest fact from segment B')
      expect(carry).not.toContain('a different conversation of the same user')
      expect(carry).not.toContain('a stranger typed this')
    })
  })

  it('caps the tail: skips empty tool-only rows, keeps the newest N non-empty, clips long bodies, labels attributed rows', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg')
      seedSegment(db, { sessionId: 'seg', userId: user.id, workspaceId: workspace.id })
      for (let index = 1; index <= DEFAULT_TAIL_MESSAGE_LIMIT + 5; index++) {
        seedMessage(db, 'seg', 'user', `message ${index}`)
        seedMessage(db, 'seg', 'assistant', '') // a tool-only step — no text
      }
      seedMessage(db, 'seg', 'assistant', 'x'.repeat(2_000), {
        sourceKind: 'workspace-manager',
        sourceLabel: 'Adam · Seo',
      })

      const { carry, tailMessageCount } = buildContinuityContext(db, {
        primarySessionId: primary.id,
        userId: user.id,
        fromSdkSessionId: 'seg',
        summary: SUMMARY,
      })

      expect(tailMessageCount).toBe(DEFAULT_TAIL_MESSAGE_LIMIT)
      // The newest ten NON-EMPTY rows: messages 7..15 + the long attributed reply.
      expect(carry).not.toContain('[user] message 6\n')
      expect(carry).toContain('[user] message 7')
      expect(carry).toContain('[user] message 15')
      expect(carry).toContain('[assistant · Adam · Seo] ' + 'x'.repeat(600) + '…')
      expect(carry).not.toContain('x'.repeat(601))
    })
  })

  it('a null summary still yields identity + tail + recovery (the forced-bridge seam); an unknown head yields identity + recovery only', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg')
      seedSegment(db, { sessionId: 'seg', userId: user.id, workspaceId: workspace.id })
      seedMessage(db, 'seg', 'user', 'the only line')

      const withoutSummary = buildContinuityContext(db, {
        primarySessionId: primary.id,
        userId: user.id,
        fromSdkSessionId: 'seg',
        summary: null,
      })
      expect(withoutSummary.carry).not.toContain('HAND-OFF SUMMARY')
      expect(withoutSummary.carry).toContain('[user] the only line')
      expect(withoutSummary.carry).toContain('HOW TO RECOVER MORE')

      const unknownHead = buildContinuityContext(db, {
        primarySessionId: primary.id,
        userId: user.id,
        fromSdkSessionId: 'never-recorded',
        summary: SUMMARY,
      })
      expect(unknownHead.tailMessageCount).toBe(0)
      expect(unknownHead.carry).not.toContain('LAST MESSAGES')
      expect(unknownHead.carry).toContain('IDENTITY:')
      expect(unknownHead.carry).toContain(SUMMARY)
    })
  })

  it('refuses a foreign primary (NotFound) — never composes for a stranger', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const intruder = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const primary = seedPrimary(db, owner.id, workspace.id, 'seg')
      expect(() =>
        buildContinuityContext(db, {
          primarySessionId: primary.id,
          userId: intruder.id,
          fromSdkSessionId: 'seg',
          summary: SUMMARY,
        }),
      ).toThrow(NotFoundError)
    })
  })

  it('names the VOICE identity, and the whole-tail cap drops the oldest lines first', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const voicePrimary = seedPrimary(db, user.id, null, 'v-1', { scope: 'voice' })
      seedSegment(db, { sessionId: 'v-1', userId: user.id, workspaceId: null, scope: 'global', visibility: 'hidden' })
      // Twelve long lines: ten survive the per-message count, then the 5k
      // total cap trims from the OLDEST end so the newest exchange always fits.
      for (let index = 1; index <= 12; index++) {
        seedMessage(db, 'v-1', 'user', `line ${index} ` + 'y'.repeat(700))
      }

      const context = buildContinuityContext(db, {
        primarySessionId: voicePrimary.id,
        userId: user.id,
        fromSdkSessionId: 'v-1',
        summary: SUMMARY,
      })

      expect(context.identityLine).toBe(
        "the user's voice conversation — the continuing spoken thread above all workspaces",
      )
      // Each line clips to 600 chars + a marker (~615 with the label); 5,000
      // total fits eight of them — the newest eight (lines 5..12).
      expect(context.tailMessageCount).toBe(8)
      expect(context.carry).toContain('[user] line 12 ')
      expect(context.carry).toContain('[user] line 5 ')
      expect(context.carry).not.toContain('[user] line 4 ')
    })
  })
})

describe('chain readers', () => {
  it('resolveSessionChainOrigin walks to the oldest segment; unknown/foreign heads resolve null', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      seedSegment(db, { sessionId: 'o-1', userId: user.id, workspaceId: null, title: 'Origin', visibility: 'listed', scope: 'spawned' })
      seedSegment(db, { sessionId: 'o-2', userId: user.id, workspaceId: null, continuedFrom: 'o-1', scope: 'spawned' })
      seedSegment(db, { sessionId: 'o-3', userId: user.id, workspaceId: null, continuedFrom: 'o-2', scope: 'spawned' })
      expect(resolveSessionChainOrigin(db, { userId: user.id, headSessionId: 'o-3' })?.id).toBe('o-1')
      expect(resolveSessionChainOrigin(db, { userId: user.id, headSessionId: 'o-1' })?.id).toBe('o-1')
      expect(resolveSessionChainOrigin(db, { userId: user.id, headSessionId: 'nope' })).toBeNull()
      expect(resolveSessionChainOrigin(db, { userId: stranger.id, headSessionId: 'o-3' })).toBeNull()
    })
  })

  it('listSessionChainTailMessages pulls the newest N across segments, chronological; foreign head → empty', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      seedSegment(db, { sessionId: 't-1', userId: user.id, workspaceId: null })
      seedSegment(db, { sessionId: 't-2', userId: user.id, workspaceId: null, continuedFrom: 't-1' })
      seedMessage(db, 't-1', 'user', 'one')
      seedMessage(db, 't-1', 'assistant', 'two')
      seedMessage(db, 't-2', 'user', 'three')
      const tail = listSessionChainTailMessages(db, { userId: user.id, headSessionId: 't-2', limit: 2 })
      expect(tail.map((m) => m.body)).toEqual(['two', 'three'])
      expect(listSessionChainTailMessages(db, { userId: stranger.id, headSessionId: 't-2', limit: 5 })).toEqual([])
    })
  })
})

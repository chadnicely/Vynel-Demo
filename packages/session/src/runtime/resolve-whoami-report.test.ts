// Integration tests for `resolveWhoamiReport` (the `whoami` op) — real SQLite.
// Pins the per-kind identity (global / workspace / spawned / agent / plain), the
// context state read from the current segment (window per model, the swap
// threshold, tokens until it), the chain refs, the duty-book binding (a book
// that is not published yet reads `exists: false`, never an error), and the
// memory tags a session stamps on what it saves.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { insertChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertPrimarySession, type PrimarySessionScope } from '../repositories/index.js'
import { markPendingCheckpoint, takePendingCheckpoint } from '../continuity/index.js'
import { resolveWhoamiReport } from './resolve-whoami-report.js'
import { DUTY_BOOK_SLUGS, resolveDutyBook } from './duty-book.js'
import { loadSessionInstruction } from '@vynel/instructions/session-instructions'

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
  currentSdkSessionId: string | null,
  identity: { scope?: PrimarySessionScope; scopeRef?: string; supersededFrom?: string } = {},
) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    ...(identity.scope !== undefined ? { scope: identity.scope } : {}),
    ...(identity.scopeRef !== undefined ? { scopeRef: identity.scopeRef } : {}),
    currentSdkSessionId,
    supersededFromSdkSessionId: identity.supersededFrom ?? null,
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
    lastContextTokens?: number
    model?: string
  },
) {
  return insertChatSession(db, {
    ...buildNewChatSessionRow({
      sessionId: row.sessionId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      providerId: 'claude',
      startedAt: new Date(),
      title: row.title ?? 'New session',
      ...(row.scope !== undefined ? { scope: row.scope } : {}),
      ...(row.visibility !== undefined ? { visibility: row.visibility } : {}),
    }),
    ...(row.continuedFrom !== undefined ? { continuedFromSessionId: row.continuedFrom } : {}),
    ...(row.lastContextTokens !== undefined ? { lastContextTokens: row.lastContextTokens } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
  })
}

describe('resolveWhoamiReport', () => {
  it('a WORKSPACE primary: identity by name, context against a 1M window, chain refs, duty book, memory tags', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, 'Seo'))
      const primary = seedPrimary(db, user.id, workspace.id, 'seg-b', { supersededFrom: 'seg-a' })
      seedSegment(db, {
        sessionId: 'seg-b',
        userId: user.id,
        workspaceId: workspace.id,
        continuedFrom: 'seg-a',
        lastContextTokens: 79_294,
        model: 'claude-opus-5',
      })

      const report = resolveWhoamiReport(db, {
        userId: user.id,
        primarySessionId: primary.id,
        workspaceId: workspace.id,
      })

      expect(report.kind).toBe('workspace')
      expect(report.identity).toBe('the continuing main conversation of workspace “Seo”')
      expect(report.primarySessionId).toBe(primary.id)
      expect(report.workspace).toEqual({ id: workspace.id, name: 'Seo' })
      expect(report.currentSegmentId).toBe('seg-b')
      expect(report.previousSegmentId).toBe('seg-a')
      expect(report.context).toEqual({
        usedTokens: 79_294,
        contextWindow: 1_000_000,
        usedFraction: 0.079294,
        swapThreshold: 0.85,
        tokensUntilSwapThreshold: 850_000 - 79_294,
        tokensUntilWindowLimit: 1_000_000 - 79_294,
        model: 'claude-opus-5',
      })
      // The duty book slot is bound even before a book is published (the
      // lookup is injected — the live shelf's contents are not this test's).
      expect(report.dutyBook.slug).toBe('duty-workspace-manager')
      const withBook = resolveWhoamiReport(
        db,
        { userId: user.id, primarySessionId: primary.id },
        { bookExists: (slug) => slug === 'duty-workspace-manager' },
      )
      expect(withBook.dutyBook).toEqual({ slug: 'duty-workspace-manager', exists: true })
      expect(report.memoryTags).toEqual(['identity:workspace', `session:${primary.id.slice(0, 8)}`])
    })
  })

  it('honors the swap-threshold override and the lazy chat segment; a segment with no usage yet reports null occupancy', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const primary = seedPrimary(db, user.id, null, 'g-1', { scope: 'global' })
      seedSegment(db, { sessionId: 'g-1', userId: user.id, workspaceId: null, scope: 'global', visibility: 'hidden' })
      // A mid-turn swap moved the turn onto g-2 — the lazy chat id wins over the primary's link.
      seedSegment(db, { sessionId: 'g-2', userId: user.id, workspaceId: null, scope: 'global', visibility: 'hidden', continuedFrom: 'g-1', lastContextTokens: 12_000, model: 'claude-haiku-4-5' })

      const report = resolveWhoamiReport(db, {
        userId: user.id,
        primarySessionId: primary.id,
        chatSessionId: 'g-2',
        swapThreshold: 0.05,
      })
      expect(report.kind).toBe('global')
      expect(report.identity).toContain('the global assistant')
      expect(report.currentSegmentId).toBe('g-2')
      // The ROW chain names the predecessor — even though the primary's own
      // supersession marker (stamped by the boundary bridge only) still says
      // an OLDER segment: a later mid-turn swap never updates it.
      expect(report.previousSegmentId).toBe('g-1')
      const other = insertUser(db, makeUser())
      const bridgedThenSwapped = seedPrimary(db, other.id, null, 'x-2', { scope: 'global', supersededFrom: 'x-0' })
      seedSegment(db, { sessionId: 'x-1', userId: other.id, workspaceId: null, scope: 'global', visibility: 'hidden', continuedFrom: 'x-0' })
      seedSegment(db, { sessionId: 'x-2', userId: other.id, workspaceId: null, scope: 'global', visibility: 'hidden', continuedFrom: 'x-1' })
      expect(
        resolveWhoamiReport(db, { userId: other.id, primarySessionId: bridgedThenSwapped.id }).previousSegmentId,
      ).toBe('x-1')
      expect(report.context).toEqual({
        usedTokens: 12_000,
        contextWindow: 200_000,
        usedFraction: 0.06,
        swapThreshold: 0.05,
        tokensUntilSwapThreshold: 10_000 - 12_000,
        tokensUntilWindowLimit: 188_000,
        model: 'claude-haiku-4-5',
      })
      expect(report.dutyBook.slug).toBe('duty-global-root')

      const quiet = resolveWhoamiReport(db, { userId: user.id, primarySessionId: primary.id })
      expect(quiet.currentSegmentId).toBe('g-1')
      expect(quiet.context?.usedTokens).toBeNull()
      expect(quiet.context?.usedFraction).toBeNull()
      expect(quiet.context?.contextWindow).toBe(200_000)
    })
  })

  it('a SPAWNED session and an AGENT colleague are named from their listed identity row; the name rides the memory tags', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, 'Acme'))
      const spawned = seedPrimary(db, user.id, workspace.id, 'sp-2', { scope: 'spawned' })
      seedSegment(db, { sessionId: 'sp-1', userId: user.id, workspaceId: workspace.id, scope: 'spawned', title: 'Mailing feature', visibility: 'listed' })
      seedSegment(db, { sessionId: 'sp-2', userId: user.id, workspaceId: workspace.id, scope: 'spawned', title: 'Continued conversation', visibility: 'hidden', continuedFrom: 'sp-1' })
      const spawnedReport = resolveWhoamiReport(db, { userId: user.id, primarySessionId: spawned.id })
      expect(spawnedReport.kind).toBe('spawned')
      expect(spawnedReport.name).toBe('Mailing feature')
      expect(spawnedReport.identity).toBe('the spawned session “Mailing feature”, grounded in workspace “Acme”')
      expect(spawnedReport.workspace?.name).toBe('Acme')
      expect(spawnedReport.dutyBook.slug).toBe('duty-spawned-session')
      expect(spawnedReport.memoryTags).toEqual(['identity:spawned', `session:${spawned.id.slice(0, 8)}`, 'Mailing feature'])

      const agent = seedPrimary(db, user.id, null, 'ag-1', { scope: 'agent', scopeRef: 'reviewer' })
      seedSegment(db, { sessionId: 'ag-1', userId: user.id, workspaceId: null, scope: 'agent', title: 'Code Reviewer', visibility: 'listed' })
      const agentReport = resolveWhoamiReport(db, { userId: user.id, primarySessionId: agent.id })
      expect(agentReport.kind).toBe('agent')
      expect(agentReport.agentSlug).toBe('reviewer')
      expect(agentReport.name).toBe('Code Reviewer')
      expect(agentReport.workspace).toBeNull()
      expect(agentReport.dutyBook.slug).toBe('duty-agent-colleague')
      expect(agentReport.memoryTags).toContain('identity:agent')
    })
  })

  it('a PLAIN conversation (no primary): says so, keeps its workspace + memory tag; a segment it does not own reveals nothing', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id, 'Acme'))
      seedSegment(db, { sessionId: 'theirs', userId: stranger.id, workspaceId: null, lastContextTokens: 5, model: 'claude-haiku-4-5' })

      const plain = resolveWhoamiReport(db, { userId: user.id, workspaceId: workspace.id, chatSessionId: 'theirs' })
      expect(plain.kind).toBe('plain')
      expect(plain.identity).toContain('workspace “Acme”')
      expect(plain.identity).toContain('no continuing identity')
      expect(plain.primarySessionId).toBeNull()
      expect(plain.workspace).toEqual({ id: workspace.id, name: 'Acme' })
      // The stranger's segment is neither described nor measured.
      expect(plain.context).toBeNull()
      expect(plain.previousSegmentId).toBeNull()
      expect(plain.dutyBook.slug).toBe('duty-workspace-session')
      expect(plain.memoryTags).toEqual(['identity:plain'])

      const bare = resolveWhoamiReport(db, { userId: user.id })
      expect(bare.identity).toBe('a conversation with no continuing identity — it does not swap or carry context')
      expect(bare.workspace).toBeNull()
    })
  })

  it("refuses a foreign primary — never describes another user's identity", async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const intruder = insertUser(db, makeUser())
      const primary = seedPrimary(db, owner.id, null, 'g-1', { scope: 'global' })
      expect(() => resolveWhoamiReport(db, { userId: intruder.id, primarySessionId: primary.id })).toThrow(NotFoundError)
    })
  })
})

describe('the duty-book binding', () => {
  it('maps every kind to a kebab-case shelf id (voice reads the global root’s book) and reads existence off the shelf', () => {
    for (const slug of Object.values(DUTY_BOOK_SLUGS)) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(DUTY_BOOK_SLUGS.voice).toBe(DUTY_BOOK_SLUGS.global)
    // The global root's standing instruction names its book by slug (the one
    // prompt that serves a single kind) — keep the two homes aligned.
    expect(loadSessionInstruction('global-root')).toContain('`' + DUTY_BOOK_SLUGS.global + '`')
    // Absent → `exists: false`, present → true, both by injection: the live
    // shelf's contents are not this test's to pin (the books land later, as
    // content, with no test change).
    expect(resolveDutyBook('spawned', { bookExists: () => false })).toEqual({ slug: 'duty-spawned-session', exists: false })
    expect(resolveDutyBook('spawned', { bookExists: (slug) => slug === 'duty-spawned-session' })).toEqual({
      slug: 'duty-spawned-session',
      exists: true,
    })
  })
})

// Audit r2 R2-H: a session must be able to LEARN it owes a step — the pull half
// of the survivor surfacing (the push half is the next turn's provider marker).
describe('the pending checkpoint', () => {
  it('rides the report while it is owed, and is null once consumed', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const primary = seedPrimary(db, user.id, null, null, { scope: 'global' })
      const at = new Date('2026-08-19T10:00:00Z')

      const before = resolveWhoamiReport(db, { userId: user.id, primarySessionId: primary.id })
      expect(before.pendingCheckpoint).toBeNull()

      markPendingCheckpoint(db, primary.id, 'ship the release notes', { now: () => at })
      expect(
        resolveWhoamiReport(db, { userId: user.id, primarySessionId: primary.id }).pendingCheckpoint,
      ).toEqual({ nextStep: 'ship the release notes', checkpointedAt: at })

      takePendingCheckpoint(db, primary.id)
      expect(
        resolveWhoamiReport(db, { userId: user.id, primarySessionId: primary.id }).pendingCheckpoint,
      ).toBeNull()
    })
  })

  it('is null for a plain conversation — it has no identity to owe anything', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      expect(resolveWhoamiReport(db, { userId: user.id }).pendingCheckpoint).toBeNull()
    })
  })
})

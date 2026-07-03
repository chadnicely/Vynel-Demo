// Tests for `@mention` resolution. `parseMentionSlugs` is pure; the
// `resolveMentions` lookup runs against real SQLite (no DB mocking).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { createAgent } from '@vynel/agents'
import { parseMentionSlugs, resolveMentions } from './resolve-mentions.js'

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
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

describe('parseMentionSlugs', () => {
  it('extracts unique @slugs in first-seen order', () => {
    expect(
      parseMentionSlugs('hey @researcher and @document-generator, then @researcher again'),
    ).toEqual(['researcher', 'document-generator'])
  })

  it('returns an empty array when there are no mentions', () => {
    expect(parseMentionSlugs('plain text with no at signs at all')).toEqual([])
  })
})

describe('resolveMentions', () => {
  it('resolves matched mentions to agent refs and drops unmatched ones', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const researcher = await createAgent(db, {
        userId: user.id,
        workspaceId: null,
        slug: 'researcher',
        name: 'Researcher',
        description: 'Researches.',
        prompt: 'You research.',
        source: 'user',
        trustTier: 'community',
      })

      const mentions = await resolveMentions(db, {
        text: 'ask @researcher and @ghost-agent to help',
        userId: user.id,
        workspaceId: workspace.id,
      })

      expect(mentions).toEqual([{ slug: 'researcher', agentId: researcher.id, name: 'Researcher' }])
    })
  })

  it('returns an empty array when the turn names no agents', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const mentions = await resolveMentions(db, {
        text: 'no mentions here',
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(mentions).toEqual([])
    })
  })
})

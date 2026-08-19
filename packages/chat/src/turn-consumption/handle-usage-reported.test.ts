// The usage handler's session-row writes, real SQLite: occupancy + the model
// that ran + the DENOMINATOR (`lastContextWindow`) — the window of the model
// the conversation is driven on: the chosen model when set, else the one that
// produced the report. Pins the audit's two failure classes: a small-model
// visitor on a big-window chain does not lower the denominator, and a
// big-model visitor on a small-chip chain does not raise it (the user's next
// small-model turn must still swap in time).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { findChatSessionById, insertChatSession, type ChatMessage } from '../repositories/index.js'
import { updateChatSessionSettings } from '../settings/update-chat-session-settings.js'
import { buildNewChatSessionRow } from './build-new-chat-session-row.js'
import { handleUsageReported } from './handle-usage-reported.js'

const OPUS = 'claude-opus-5' // 1M window
const HAIKU = 'claude-haiku-4-5' // 200k window

function seedSession(db: Database, sessionId: string): void {
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
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId: user.id,
      workspaceId: null,
      providerId: 'claude',
      startedAt: now,
      title: 'Global brain',
      scope: 'global',
    }),
  )
}

function report(db: Database, sessionId: string, model: string | undefined, inputTokens: number, sessionModel: string | null = null) {
  return handleUsageReported({
    db,
    event: {
      kind: 'usage-reported',
      sessionId,
      ...(model !== undefined ? { model } : {}),
      inputTokens,
      outputTokens: 10,
    },
    sessionId,
    sessionModel,
    assistantMessageByMessageId: new Map<string, ChatMessage>(),
  })
}

describe('handleUsageReported — the session row', () => {
  it('writes occupancy, the model that ran, and the denominator from that model when nothing is chosen', async () => {
    await withTestDatabase((db) => {
      seedSession(db, 'seg')
      const handled = report(db, 'seg', HAIKU, 50_000)
      expect(handled.sessionModel).toBe(HAIKU)
      expect(findChatSessionById(db, 'seg')).toMatchObject({
        lastContextTokens: 50_000,
        model: HAIKU,
        lastContextWindow: 200_000,
      })
      // A later report on a bigger model moves both — the chain follows what runs it.
      report(db, 'seg', OPUS, 60_000, HAIKU)
      expect(findChatSessionById(db, 'seg')).toMatchObject({ model: OPUS, lastContextWindow: 1_000_000 })
    })
  })

  it('a small-model turn on a chain CHOSEN big does not lower the denominator', async () => {
    await withTestDatabase((db) => {
      seedSession(db, 'seg')
      updateChatSessionSettings(db, 'seg', { selectedModel: OPUS })
      report(db, 'seg', OPUS, 400_000)
      // A delegated visitor pinned to haiku ran a turn on the same segment.
      report(db, 'seg', HAIKU, 150_000)
      const row = findChatSessionById(db, 'seg')!
      // What ran is recorded honestly; what the chain is measured against is not.
      expect(row.model).toBe(HAIKU)
      expect(row.lastContextTokens).toBe(150_000)
      expect(row.lastContextWindow).toBe(1_000_000)
    })
  })

  it('a big-model turn on a chain CHOSEN small does not raise the denominator — the next small turn must still swap in time', async () => {
    await withTestDatabase((db) => {
      seedSession(db, 'seg')
      updateChatSessionSettings(db, 'seg', { selectedModel: HAIKU })
      report(db, 'seg', OPUS, 500_000)
      expect(findChatSessionById(db, 'seg')).toMatchObject({ model: OPUS, lastContextWindow: 200_000 })
    })
  })

  it('a report with no model at all leaves the denominator as it was', async () => {
    await withTestDatabase((db) => {
      seedSession(db, 'seg')
      report(db, 'seg', undefined, 1_000)
      expect(findChatSessionById(db, 'seg')).toMatchObject({ lastContextTokens: 1_000, model: null, lastContextWindow: null })
      // …but the consumer's known session model still names the denominator.
      report(db, 'seg', undefined, 2_000, OPUS)
      expect(findChatSessionById(db, 'seg')).toMatchObject({ lastContextTokens: 2_000, lastContextWindow: 1_000_000 })
    })
  })
})

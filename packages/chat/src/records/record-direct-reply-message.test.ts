import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'
import {
  insertChatSession,
  listChatMessagesForSession,
  findChatSessionById,
} from '../repositories/index.js'
import { recordDirectReplyMessage } from './record-direct-reply-message.js'

describe('recordDirectReplyMessage', () => {
  it('persists the colleague reply as an inbound agent row with the chain keys + bumps lastMessageAt', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, {
        id: randomUUID(),
        displayName: 'T',
        emailAddress: null,
        locale: 'en-US',
        timezone: 'UTC',
        hasCompletedOnboarding: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      insertChatSession(
        db,
        buildNewChatSessionRow({
          sessionId: 'g-root-1',
          userId: user.id,
          workspaceId: null,
          providerId: 'claude',
          startedAt: new Date('2026-06-01T00:00:00Z'),
        }),
      )

      const persisted = recordDirectReplyMessage(db, {
        targetSessionId: 'g-root-1',
        body: '[Report from James · Claw Launcher — …]\n\nOverview of the module.',
        sourceLabel: 'James · Claw Launcher',
        threadId: 'thread-1',
        partialSessionId: 'trace-1',
      })

      expect(persisted).toBe(true)
      const [row] = listChatMessagesForSession(db, 'g-root-1')
      // The inbound-report shape: the box renders the colleague speaking.
      expect(row!.role).toBe('user')
      expect(row!.sourceKind).toBe('agent')
      expect(row!.sourceLabel).toBe('James · Claw Launcher')
      expect(row!.threadId).toBe('thread-1')
      expect(row!.partialSessionId).toBe('trace-1')
      expect(findChatSessionById(db, 'g-root-1')!.lastMessageAt.getTime()).toBeGreaterThan(
        new Date('2026-06-01T00:00:00Z').getTime(),
      )
    })
  })

  it('never mints a global-root session — a missing row returns false, no insert', async () => {
    await withTestDatabase(async (db) => {
      const persisted = recordDirectReplyMessage(db, {
        targetSessionId: 'missing',
        body: 'x',
        sourceLabel: 'James',
      })
      expect(persisted).toBe(false)
      expect(findChatSessionById(db, 'missing')).toBeNull()
    })
  })
})

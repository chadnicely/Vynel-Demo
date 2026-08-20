// The two shapes of a system-authored note: continuity's ANONYMOUS one
// (sourceKind 'global-root', no label) and the ATTRIBUTED one a producer signs
// (sourceKind 'system' + "Schedule · Tea"). The label must never leak into the
// body — a verbatim reminder's body IS the user's own words.

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
import { recordSystemNoteMessage } from './record-system-note-message.js'

function seedSession(db: Parameters<typeof insertChatSession>[0], sessionId: string): void {
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
      sessionId,
      userId: user.id,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date('2026-06-01T00:00:00Z'),
    }),
  )
}

describe('recordSystemNoteMessage', () => {
  it('persists the anonymous continuity note and bumps lastMessageAt', async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'head-1')

      expect(recordSystemNoteMessage(db, { sessionId: 'head-1', body: 'Not continued.' })).toBe(true)

      const [row] = listChatMessagesForSession(db, 'head-1')
      expect(row!.role).toBe('user')
      expect(row!.sourceKind).toBe('global-root')
      expect(row!.sourceLabel).toBeNull()
      expect(findChatSessionById(db, 'head-1')!.lastMessageAt.getTime()).toBeGreaterThan(
        new Date('2026-06-01T00:00:00Z').getTime(),
      )
    })
  })

  it('signs an attributed notice as sourceKind system + the label, body untouched', async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'head-2')

      recordSystemNoteMessage(db, {
        sessionId: 'head-2',
        body: 'Attend your 2pm meeting',
        sourceLabel: 'Schedule · Meeting',
      })

      const [row] = listChatMessagesForSession(db, 'head-2')
      expect(row!.sourceKind).toBe('system')
      expect(row!.sourceLabel).toBe('Schedule · Meeting')
      expect(row!.body).toBe('Attend your 2pm meeting')
    })
  })

  it('never mints a session — a missing row returns false, no insert', async () => {
    await withTestDatabase(async (db) => {
      expect(recordSystemNoteMessage(db, { sessionId: 'gone', body: 'x' })).toBe(false)
      expect(listChatMessagesForSession(db, 'gone')).toHaveLength(0)
    })
  })
})

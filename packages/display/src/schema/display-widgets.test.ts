// Schema round-trip on real SQLite: the json `content` column returns the
// discriminated object it was handed (not a string), timestamps come back as
// `Date`, and a read never crosses a user or a scope.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import {
  insertDisplayWidget,
  findDisplayWidget,
  listDisplayWidgetsForScope,
} from '../repositories/index.js'
import { seedUser } from '../test-support.js'
import type { DisplayWidgetContent } from '@vynel/contracts/display/display-widget-content'

const TABLE: DisplayWidgetContent = {
  kind: 'table',
  columns: ['day', 'runs'],
  rows: [['mon', '3']],
  caption: 'this week',
}

describe('display_widgets schema', () => {
  it('round-trips a row, json content and timestamps included', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const createdAt = new Date('2026-08-21T09:00:00.000Z')
      const expiresAt = new Date('2026-08-21T10:00:00.000Z')

      const inserted = insertDisplayWidget(db, {
        id: randomUUID(),
        userId,
        scopeKey: 'global',
        title: 'Schedule runs',
        kind: 'table',
        content: TABLE,
        slot: 'stage',
        size: 'lg',
        sortOrder: 0,
        createdBySessionId: 'session-1',
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      })

      const found = findDisplayWidget(db, { userId, widgetId: inserted.id })
      expect(found?.content).toEqual(TABLE)
      expect(found?.createdAt).toBeInstanceOf(Date)
      expect(found?.createdAt.toISOString()).toBe(createdAt.toISOString())
      expect(found?.expiresAt?.toISOString()).toBe(expiresAt.toISOString())
      expect(found?.createdBySessionId).toBe('session-1')
    })
  })

  it('orders a scope by slot rank first, then by position within the slot', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const now = new Date()
      const place = (slot: 'left' | 'stage' | 'right' | 'dock', sortOrder: number, title: string) =>
        insertDisplayWidget(db, {
          id: randomUUID(),
          userId,
          scopeKey: 'global',
          title,
          kind: 'markdown',
          content: { kind: 'markdown', body: title },
          slot,
          size: 'md',
          sortOrder,
          createdBySessionId: null,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        })

      place('dock', 0, 'd')
      place('stage', 1, 's1')
      place('left', 0, 'l')
      place('stage', 0, 's0')

      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' }).map((row) => row.title)).toEqual([
        'l',
        's0',
        's1',
        'd',
      ])
    })
  })

  it('never reads across a user or a scope', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db, 'Dana')
      const stranger = seedUser(db, 'Sam')
      const now = new Date()
      const place = (userId: string, scopeKey: string, title: string) =>
        insertDisplayWidget(db, {
          id: randomUUID(),
          userId,
          scopeKey,
          title,
          kind: 'markdown',
          content: { kind: 'markdown', body: title },
          slot: 'stage',
          size: 'md',
          sortOrder: 0,
          createdBySessionId: null,
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        })

      const mine = place(owner, 'global', 'mine')
      place(owner, 'ws-1', 'other scope')
      place(stranger, 'global', 'theirs')

      expect(listDisplayWidgetsForScope(db, { userId: owner, scopeKey: 'global' }).map((r) => r.title)).toEqual([
        'mine',
      ])
      expect(findDisplayWidget(db, { userId: stranger, widgetId: mine.id })).toBeNull()
    })
  })
})

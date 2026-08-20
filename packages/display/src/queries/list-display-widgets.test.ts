import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { addDisplayWidget } from '../lifecycle/add-display-widget.js'
import { listDisplayWidgets } from './list-display-widgets.js'
import { DISPLAY_WIDGET_REMOVED } from '../display-events.js'
import { insertDisplayWidget } from '../repositories/index.js'
import { createRecordingSink, markdownContent, seedUser } from '../test-support.js'

describe('listDisplayWidgets', () => {
  it('returns the scope\'s board in slot order as wire views', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const base = { userId, scopeKey: 'global', content: markdownContent() }
      addDisplayWidget(db, { ...base, title: 'dock-0', slot: 'dock' })
      addDisplayWidget(db, { ...base, title: 'stage-0', slot: 'stage' })
      addDisplayWidget(db, { ...base, title: 'left-0', slot: 'left' })
      addDisplayWidget(db, { ...base, title: 'stage-1', slot: 'stage' })
      addDisplayWidget(db, { userId, scopeKey: 'ws-1', title: 'elsewhere', content: markdownContent() })

      const board = listDisplayWidgets(db, { userId, scopeKey: 'global' })
      expect(board.map((widget) => widget.title)).toEqual(['left-0', 'stage-0', 'stage-1', 'dock-0'])
      // ISO strings, not Dates — this crosses JSON both ways.
      expect(typeof board[0]!.createdAt).toBe('string')
      expect(board[0]!.expiresAt).toBeNull()
    })
  })

  it('sweeps expired cards lazily before reading, emitting their removals', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: 'fresh',
        content: markdownContent(),
        expiresAt: new Date(Date.now() + 60_000),
      })
      // Seeded through the repository on purpose: `add` sweeps expired cards
      // itself, so an already-dead card can only reach the list by going in
      // behind that op's back — which is exactly the state a boot-less process
      // finds when a card expires while nobody is looking.
      const now = new Date()
      const stale = insertDisplayWidget(db, {
        id: randomUUID(),
        userId,
        scopeKey: 'global',
        title: 'stale',
        kind: 'markdown',
        content: markdownContent(),
        slot: 'stage',
        size: 'md',
        sortOrder: 1,
        createdBySessionId: null,
        expiresAt: new Date(Date.now() - 60_000),
        createdAt: now,
        updatedAt: now,
      })

      const sink = createRecordingSink(db)
      const board = listDisplayWidgets(db, { userId, scopeKey: 'global' }, { liveSink: sink })

      expect(board.map((widget) => widget.title)).toEqual(['fresh'])
      expect(sink.frames).toEqual([{ kind: 'removed', widgetId: stale.id, scopeKey: 'global' }])
      const events = listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ widgetId: stale.id, reason: 'expired' })

      // A second read finds nothing left to sweep.
      expect(listDisplayWidgets(db, { userId, scopeKey: 'global' })).toHaveLength(1)
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)).toHaveLength(1)
    })
  })

  it('starts empty and never crosses into another user\'s board', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db, 'Dana')
      const stranger = seedUser(db, 'Sam')
      addDisplayWidget(db, {
        userId: stranger,
        scopeKey: 'global',
        title: 'theirs',
        content: markdownContent(),
      })

      expect(listDisplayWidgets(db, { userId: owner, scopeKey: 'global' })).toEqual([])
    })
  })
})

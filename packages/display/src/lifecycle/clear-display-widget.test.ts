import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { addDisplayWidget } from './add-display-widget.js'
import { clearDisplayWidgets } from './clear-display-widget.js'
import { DISPLAY_CLEARED, DISPLAY_WIDGET_REMOVED } from '../display-events.js'
import { listDisplayWidgetsForScope } from '../repositories/index.js'
import { createRecordingSink, markdownContent, seedUser } from '../test-support.js'

describe('clearDisplayWidgets', () => {
  it('wipes one scope with ONE cleared event and one frame, leaving other scopes alone', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const base = { userId, content: markdownContent() }
      addDisplayWidget(db, { ...base, scopeKey: 'global', title: 'a' })
      addDisplayWidget(db, { ...base, scopeKey: 'global', title: 'b' })
      addDisplayWidget(db, { ...base, scopeKey: 'ws-1', title: 'kept' })

      const sink = createRecordingSink(db)
      expect(clearDisplayWidgets(db, { userId, scopeKey: 'global' }, { liveSink: sink })).toEqual({
        clearedCount: 2,
      })

      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' })).toEqual([])
      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'ws-1' })).toHaveLength(1)
      expect(sink.frames).toEqual([{ kind: 'cleared', scopeKey: 'global' }])

      // One user action, one event — not N removals.
      const cleared = listOutboxEventsByType(db, DISPLAY_CLEARED)
      expect(cleared).toHaveLength(1)
      expect(cleared[0]!.payload).toMatchObject({ scopeKey: 'global', widgetCount: 2 })
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)).toEqual([])
    })
  })

  it('never touches another user\'s board', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db, 'Dana')
      const stranger = seedUser(db, 'Sam')
      addDisplayWidget(db, {
        userId: stranger,
        scopeKey: 'global',
        title: 'theirs',
        content: markdownContent(),
      })

      expect(clearDisplayWidgets(db, { userId: owner, scopeKey: 'global' })).toEqual({ clearedCount: 0 })
      expect(listDisplayWidgetsForScope(db, { userId: stranger, scopeKey: 'global' })).toHaveLength(1)
    })
  })

  it('writes nothing at all for an already-empty board', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const sink = createRecordingSink(db)

      expect(clearDisplayWidgets(db, { userId, scopeKey: 'global' }, { liveSink: sink })).toEqual({
        clearedCount: 0,
      })
      expect(listOutboxEventsByType(db, DISPLAY_CLEARED)).toEqual([])
      expect(sink.frames).toEqual([])
    })
  })
})

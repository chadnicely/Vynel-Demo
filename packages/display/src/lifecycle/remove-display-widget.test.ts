import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { addDisplayWidget } from './add-display-widget.js'
import { removeDisplayWidget } from './remove-display-widget.js'
import { DISPLAY_WIDGET_REMOVED } from '../display-events.js'
import { listDisplayWidgetsForScope } from '../repositories/index.js'
import { createRecordingSink, markdownContent, seedUser } from '../test-support.js'

describe('removeDisplayWidget', () => {
  it('deletes the row, co-commits a requested removal, and publishes after commit', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const widget = addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: 'Runs',
        content: markdownContent(),
      })

      const sink = createRecordingSink(db)
      const removed = removeDisplayWidget(db, { userId, widgetId: widget.id }, { liveSink: sink })

      expect(removed).toEqual(widget)
      expect(sink.sawOpenTransaction).toBe(false)
      expect(sink.frames).toEqual([{ kind: 'removed', widgetId: widget.id, scopeKey: 'global' }])

      const events = listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ widgetId: widget.id, reason: 'requested' })
    })
  })

  it('throws the same NotFound for a missing widget and for someone else\'s', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db, 'Dana')
      const stranger = seedUser(db, 'Sam')
      const widget = addDisplayWidget(db, {
        userId: owner,
        scopeKey: 'global',
        title: 'Mine',
        content: markdownContent(),
      })

      const sink = createRecordingSink(db)
      expect(() => removeDisplayWidget(db, { userId: owner, widgetId: 'no-such-id' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        removeDisplayWidget(db, { userId: stranger, widgetId: widget.id }, { liveSink: sink }),
      ).toThrow(NotFoundError)

      expect(listDisplayWidgetsForScope(db, { userId: owner, scopeKey: 'global' })).toHaveLength(1)
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)).toEqual([])
      expect(sink.frames).toEqual([])
    })
  })
})

import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { addDisplayWidget } from './add-display-widget.js'
import { sweepExpiredDisplayWidgets } from './sweep-expired-display-widgets.js'
import { DISPLAY_WIDGET_REMOVED } from '../display-events.js'
import { listDisplayWidgetsForScope } from '../repositories/index.js'
import { createRecordingSink, markdownContent, seedUser } from '../test-support.js'
import type { Database } from '@vynel/db'

// Anchored to the REAL clock: addDisplayWidget sweeps its scope on new Date(), so a
// row that is already expired in wall time would vanish before the boot pass could
// count it (the fixed 2026-08-21 dates did exactly that once the day passed). The
// rows expire a minute from now; the boot pass runs "two minutes later".
const CLOCK = Date.now()
const PAST = new Date(CLOCK + 60_000)
const FUTURE = new Date(CLOCK + 3_600_000)
const NOW = new Date(CLOCK + 120_000)

function place(db: Database, userId: string, scopeKey: string, title: string, expiresAt: Date | null) {
  return addDisplayWidget(db, { userId, scopeKey, title, content: markdownContent(), expiresAt })
}

describe('sweepExpiredDisplayWidgets', () => {
  it('drops only what is past its expiry, process-wide, on the boot pass', async () => {
    await withTestDatabase(async (db) => {
      const owner = seedUser(db, 'Dana')
      const stranger = seedUser(db, 'Sam')
      place(db, owner, 'global', 'stale', PAST)
      place(db, owner, 'global', 'pending', FUTURE)
      place(db, owner, 'ws-1', 'permanent', null)
      place(db, stranger, 'global', 'their stale', PAST)

      const sink = createRecordingSink(db)
      expect(sweepExpiredDisplayWidgets(db, { now: NOW }, { liveSink: sink })).toEqual({ sweptCount: 2 })

      expect(listDisplayWidgetsForScope(db, { userId: owner, scopeKey: 'global' }).map((r) => r.title)).toEqual([
        'pending',
      ])
      expect(listDisplayWidgetsForScope(db, { userId: owner, scopeKey: 'ws-1' })).toHaveLength(1)
      expect(listDisplayWidgetsForScope(db, { userId: stranger, scopeKey: 'global' })).toEqual([])

      const events = listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)
      expect(events).toHaveLength(2)
      expect(events.every((event) => (event.payload as { reason: string }).reason === 'expired')).toBe(true)
      // The process-wide pass is the BOOT pass — nothing is connected yet, so
      // it stays silent rather than addressing windows that do not exist.
      expect(sink.frames).toEqual([])
    })
  })

  it('narrows to one scope when given one, and THAT pass publishes', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      place(db, userId, 'global', 'global stale', PAST)
      const stale = place(db, userId, 'ws-1', 'workspace stale', PAST)

      const sink = createRecordingSink(db)
      expect(
        sweepExpiredDisplayWidgets(db, { userId, scopeKey: 'ws-1', now: NOW }, { liveSink: sink }),
      ).toEqual({ sweptCount: 1 })
      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' })).toHaveLength(1)
      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'ws-1' })).toEqual([])
      // A userId is present, so the removal has a window to reach.
      expect(sink.frames).toEqual([{ kind: 'removed', widgetId: stale.id, scopeKey: 'ws-1' }])
      expect(sink.userIds).toEqual([userId])
    })
  })

  it('writes nothing when nothing has expired', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      place(db, userId, 'global', 'pending', FUTURE)
      const sink = createRecordingSink(db)

      expect(sweepExpiredDisplayWidgets(db, { now: NOW }, { liveSink: sink })).toEqual({ sweptCount: 0 })
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)).toEqual([])
      expect(sink.frames).toEqual([])
    })
  })
})

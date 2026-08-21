import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { addDisplayWidget } from './add-display-widget.js'
import { updateDisplayWidget } from './update-display-widget.js'
import { DISPLAY_WIDGET_UPSERTED } from '../display-events.js'
import { findDisplayWidget } from '../repositories/index.js'
import { createRecordingSink, markdownContent, seedUser } from '../test-support.js'
import type {
  DisplayWidgetContent,
  DisplayWidgetSize,
  DisplayWidgetSlot,
} from '@vynel/contracts/display/display-widget-content'

const CHART: DisplayWidgetContent = {
  kind: 'chart',
  type: 'bar',
  series: [{ name: 'runs', points: [{ label: 'mon', value: 3 }] }],
}

describe('updateDisplayWidget', () => {
  it('patches title + content, rewrites kind to match, and publishes after commit', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const widget = addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: 'Runs',
        content: markdownContent(),
      })

      const sink = createRecordingSink(db)
      const updated = updateDisplayWidget(
        db,
        { userId, widgetId: widget.id, title: 'Runs, charted', content: CHART, size: 'lg' },
        { liveSink: sink },
      )

      expect(updated).toMatchObject({
        id: widget.id,
        title: 'Runs, charted',
        kind: 'chart',
        content: CHART,
        size: 'lg',
      })
      // The row's kind IS content.kind — the two can never diverge.
      expect(findDisplayWidget(db, { userId, widgetId: widget.id })?.kind).toBe('chart')
      expect(sink.frames).toEqual([{ kind: 'upserted', widget: updated }])
      expect(sink.sawOpenTransaction).toBe(false)
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_UPSERTED)).toHaveLength(2)
    })
  })

  it('sends a moved card to the end of its new slot', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const base = { userId, scopeKey: 'global', content: markdownContent() }
      addDisplayWidget(db, { ...base, title: 'left-0', slot: 'left' })
      const mover = addDisplayWidget(db, { ...base, title: 'stage-0', slot: 'stage' })

      const moved = updateDisplayWidget(db, { userId, widgetId: mover.id, slot: 'left' })
      expect(moved).toMatchObject({ slot: 'left', sortOrder: 1 })

      // Re-stating the same slot is not a move — the position stays put.
      expect(updateDisplayWidget(db, { userId, widgetId: mover.id, slot: 'left' }).sortOrder).toBe(1)
    })
  })

  it('clears an expiry when expiresAt is passed as null', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const widget = addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: 'Temporary',
        content: markdownContent(),
        expiresAt: new Date('2026-08-21T10:00:00.000Z'),
      })

      expect(updateDisplayWidget(db, { userId, widgetId: widget.id, expiresAt: null }).expiresAt).toBeNull()
    })
  })

  it('re-validates content, leaving the stored row untouched', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const widget = addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: 'Runs',
        content: markdownContent('keep me'),
      })

      const sink = createRecordingSink(db)
      expect(() =>
        updateDisplayWidget(
          db,
          { userId, widgetId: widget.id, content: markdownContent('x'.repeat(33_000)) },
          { liveSink: sink },
        ),
      ).toThrow(ValidationError)

      expect(findDisplayWidget(db, { userId, widgetId: widget.id })?.content).toEqual(
        markdownContent('keep me'),
      )
      expect(sink.frames).toEqual([])
    })
  })

  it('re-validates slot and size, leaving the stored row untouched', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const widget = addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: 'Runs',
        content: markdownContent(),
        slot: 'stage',
      })

      expect(() =>
        updateDisplayWidget(db, { userId, widgetId: widget.id, slot: 'middle' as DisplayWidgetSlot }),
      ).toThrow(ValidationError)
      expect(() =>
        updateDisplayWidget(db, { userId, widgetId: widget.id, size: 'xl' as DisplayWidgetSize }),
      ).toThrow(ValidationError)
      expect(findDisplayWidget(db, { userId, widgetId: widget.id })?.slot).toBe('stage')
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

      expect(() => updateDisplayWidget(db, { userId: owner, widgetId: 'no-such-id', title: 'x' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        updateDisplayWidget(db, { userId: stranger, widgetId: widget.id, title: 'theirs now' }),
      ).toThrow(NotFoundError)
      expect(findDisplayWidget(db, { userId: owner, widgetId: widget.id })?.title).toBe('Mine')
    })
  })
})

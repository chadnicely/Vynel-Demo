import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { DISPLAY_MAX_WIDGETS_PER_SCOPE } from '@vynel/contracts/display/display-widget-content'
import { addDisplayWidget } from './add-display-widget.js'
import { DISPLAY_WIDGET_REMOVED, DISPLAY_WIDGET_UPSERTED } from '../display-events.js'
import {
  insertDisplayWidget,
  listDisplayWidgetsForScope,
} from '../repositories/index.js'
import { createRecordingSink, markdownContent, seedUser } from '../test-support.js'
import type { Database } from '@vynel/db'
import type {
  DisplayWidgetContent,
  DisplayWidgetSize,
  DisplayWidgetSlot,
} from '@vynel/contracts/display/display-widget-content'

// Seeded through the repository, one millisecond apart: "the oldest" must be
// unambiguous, and twelve adds in the same tick would fall back to an id tiebreak.
function fill(db: Database, userId: string, count: number, scopeKey = 'global') {
  const base = Date.parse('2026-08-21T09:00:00.000Z')
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(base + index)
    return insertDisplayWidget(db, {
      id: randomUUID(),
      userId,
      scopeKey,
      title: `card ${index}`,
      kind: 'markdown',
      content: markdownContent(`body ${index}`),
      slot: 'stage',
      size: 'md',
      sortOrder: index,
      createdBySessionId: null,
      expiresAt: null,
      createdAt: at,
      updatedAt: at,
    })
  })
}

describe('addDisplayWidget', () => {
  it('writes the row, derives kind from the content, and co-commits one upserted event', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const content: DisplayWidgetContent = {
        kind: 'metric',
        value: '12',
        label: 'runs today',
        tone: 'live',
      }

      const view = addDisplayWidget(db, {
        userId,
        scopeKey: 'global',
        title: '  Runs  ',
        content,
        size: 'sm',
        createdBySessionId: 'session-9',
      })

      expect(view).toMatchObject({
        scopeKey: 'global',
        title: 'Runs',
        kind: 'metric',
        content,
        slot: 'stage',
        size: 'sm',
        sortOrder: 0,
        createdBySessionId: 'session-9',
        expiresAt: null,
      })
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_UPSERTED)).toHaveLength(1)
    })
  })

  it('assigns sortOrder as max + 1 WITHIN the slot, not across the scope', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const base = { userId, scopeKey: 'global', content: markdownContent() }

      expect(addDisplayWidget(db, { ...base, title: 'a', slot: 'stage' }).sortOrder).toBe(0)
      expect(addDisplayWidget(db, { ...base, title: 'b', slot: 'stage' }).sortOrder).toBe(1)
      expect(addDisplayWidget(db, { ...base, title: 'c', slot: 'left' }).sortOrder).toBe(0)
      expect(addDisplayWidget(db, { ...base, title: 'd', slot: 'left' }).sortOrder).toBe(1)
      expect(addDisplayWidget(db, { ...base, title: 'e', slot: 'stage' }).sortOrder).toBe(2)
    })
  })

  it('rejects invalid content and over-sized content with a ValidationError', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const base = { userId, scopeKey: 'global', title: 'bad' }

      expect(() =>
        addDisplayWidget(db, {
          ...base,
          content: { kind: 'table', columns: ['a', 'b'], rows: [['only-one']] } as DisplayWidgetContent,
        }),
      ).toThrow(ValidationError)

      expect(() =>
        addDisplayWidget(db, { ...base, content: markdownContent('x'.repeat(33_000)) }),
      ).toThrow(ValidationError)

      expect(() => addDisplayWidget(db, { ...base, title: '   ', content: markdownContent() })).toThrow(
        ValidationError,
      )

      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' })).toEqual([])
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_UPSERTED)).toEqual([])
    })
  })

  it('rejects an unknown slot or size before anything is written', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const base = { userId, scopeKey: 'global', title: 'placed', content: markdownContent() }

      // A stranger slot is not cosmetic: the board's order is
      // DISPLAY_WIDGET_SLOTS.indexOf(slot), which answers -1 for it.
      expect(() =>
        addDisplayWidget(db, { ...base, slot: 'middle' as DisplayWidgetSlot }),
      ).toThrow(ValidationError)
      expect(() => addDisplayWidget(db, { ...base, size: 'xl' as DisplayWidgetSize })).toThrow(
        ValidationError,
      )
      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' })).toEqual([])
    })
  })

  it('evicts the oldest at the cap, emitting removed + upserted in ONE transaction', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const existing = fill(db, userId, DISPLAY_MAX_WIDGETS_PER_SCOPE)
      const oldest = existing[0]!

      const sink = createRecordingSink(db)
      const thirteenth = addDisplayWidget(
        db,
        { userId, scopeKey: 'global', title: 'newest', content: markdownContent() },
        { liveSink: sink },
      )

      const rows = listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' })
      expect(rows).toHaveLength(DISPLAY_MAX_WIDGETS_PER_SCOPE)
      expect(rows.map((row) => row.id)).not.toContain(oldest.id)
      expect(rows.map((row) => row.id)).toContain(thirteenth.id)

      const removed = listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)
      expect(removed).toHaveLength(1)
      expect(removed[0]!.payload).toMatchObject({ widgetId: oldest.id, reason: 'evicted' })
      // The twelve were seeded through the repository — only the add emits.
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_UPSERTED)).toHaveLength(1)

      // Removed first — a watching window must never hold thirteen cards.
      expect(sink.frames).toEqual([
        { kind: 'removed', widgetId: oldest.id, scopeKey: 'global' },
        { kind: 'upserted', widget: thirteenth },
      ])
      // Both frames are addressed to the owner — the channel is per user.
      expect(sink.userIds).toEqual([userId, userId])
      expect(sink.sawOpenTransaction).toBe(false)
    })
  })

  it('sweeps an expired squatter at the cap instead of evicting a live card', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const live = fill(db, userId, DISPLAY_MAX_WIDGETS_PER_SCOPE - 1)
      // The twelfth is already dead but still occupying a slot — and it is the
      // NEWEST, so an eviction by age would drop a live morning card instead.
      const dead = new Date(Date.parse('2026-08-21T09:00:00.000Z') + 100)
      const squatter = insertDisplayWidget(db, {
        id: randomUUID(),
        userId,
        scopeKey: 'global',
        title: 'expired',
        kind: 'markdown',
        content: markdownContent(),
        slot: 'stage',
        size: 'md',
        sortOrder: 99,
        createdBySessionId: null,
        expiresAt: new Date(Date.now() - 60_000),
        createdAt: dead,
        updatedAt: dead,
      })

      const sink = createRecordingSink(db)
      const added = addDisplayWidget(
        db,
        { userId, scopeKey: 'global', title: 'newest', content: markdownContent() },
        { liveSink: sink },
      )

      const ids = listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' }).map((row) => row.id)
      expect(ids).toHaveLength(DISPLAY_MAX_WIDGETS_PER_SCOPE)
      expect(ids).not.toContain(squatter.id)
      for (const row of live) expect(ids).toContain(row.id)
      expect(ids).toContain(added.id)

      // The freed slot means nothing needed evicting — one expired removal only.
      const removed = listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)
      expect(removed).toHaveLength(1)
      expect(removed[0]!.payload).toMatchObject({ widgetId: squatter.id, reason: 'expired' })
      expect(sink.frames).toEqual([
        { kind: 'removed', widgetId: squatter.id, scopeKey: 'global' },
        { kind: 'upserted', widget: added },
      ])
      expect(sink.sawOpenTransaction).toBe(false)
    })
  })

  it('counts the cap per scope, so a workspace board never evicts a global card', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      fill(db, userId, DISPLAY_MAX_WIDGETS_PER_SCOPE, 'global')
      addDisplayWidget(db, { userId, scopeKey: 'ws-1', title: 'ws', content: markdownContent() })

      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'global' })).toHaveLength(
        DISPLAY_MAX_WIDGETS_PER_SCOPE,
      )
      expect(listDisplayWidgetsForScope(db, { userId, scopeKey: 'ws-1' })).toHaveLength(1)
      expect(listOutboxEventsByType(db, DISPLAY_WIDGET_REMOVED)).toEqual([])
    })
  })

  it('publishes AFTER the commit, and not at all when the transaction throws', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const sink = createRecordingSink(db)

      addDisplayWidget(
        db,
        { userId, scopeKey: 'global', title: 'live', content: markdownContent() },
        { liveSink: sink },
      )
      expect(sink.frames).toHaveLength(1)
      expect(sink.sawOpenTransaction).toBe(false)

      // An unknown owner trips the kernel FK INSIDE the transaction (pragma
      // foreign_keys is ON) — the row rolls back and nothing may be published.
      expect(() =>
        addDisplayWidget(
          db,
          { userId: 'no-such-user', scopeKey: 'global', title: 'ghost', content: markdownContent() },
          { liveSink: sink },
        ),
      ).toThrow()
      expect(sink.frames).toHaveLength(1)
    })
  })
})

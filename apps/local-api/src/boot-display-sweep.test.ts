// The boot pass over a real database: a card whose expiry fell while the app
// was closed is gone before the first window can read the board.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { addDisplayWidget, listDisplayWidgets } from '@vynel/display'
import type { Database } from '@vynel/db'
import { sweepExpiredDisplayWidgetsAtBoot } from './boot-display-sweep.js'

function recordingLogger() {
  return { info: vi.fn(), error: vi.fn() }
}

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

function place(db: Database, userId: string, title: string, expiresAt: Date | null) {
  return addDisplayWidget(db, {
    userId,
    scopeKey: 'global',
    title,
    content: { kind: 'markdown', body: '# note' },
    expiresAt,
  })
}

describe('sweepExpiredDisplayWidgetsAtBoot', () => {
  it('takes down what expired while the app was closed, and leaves the rest', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      // The expired card goes on LAST: every `add` sweeps before it inserts,
      // so a later one would tidy this away and leave the pass nothing to do.
      place(db, userId, 'permanent', null)
      place(db, userId, 'yesterday', new Date(Date.now() - 60_000))
      const logger = recordingLogger()

      sweepExpiredDisplayWidgetsAtBoot(db, { logger })

      // The count is the proof the BOOT pass did it — reading the board runs a
      // lazy sweep of its own, so an empty list alone would prove nothing.
      expect(logger.info).toHaveBeenCalledWith(
        { sweptCount: 1 },
        'boot display sweep removed expired widgets',
      )
      expect(
        listDisplayWidgets(db, { userId, scopeKey: 'global' }).map((widget) => widget.title),
      ).toEqual(['permanent'])
    })
  })

  it('says nothing when there was nothing to take down', async () => {
    await withTestDatabase(async (db) => {
      const logger = recordingLogger()
      sweepExpiredDisplayWidgetsAtBoot(db, { logger })
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  // Best-effort like every sibling recovery pass: a board that failed to tidy
  // itself must never be the reason the machine will not start.
  it('logs a failed sweep instead of taking boot down with it', () => {
    const logger = recordingLogger()

    expect(() =>
      sweepExpiredDisplayWidgetsAtBoot({} as unknown as Database, { logger }),
    ).not.toThrow()
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})

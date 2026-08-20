// Shared seeds for the display tests (the asks/tasks test-support precedent;
// the production barrel keeps schema and repositories internal).

import { randomUUID } from 'node:crypto'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import type { DisplayLiveFrame } from '@vynel/contracts/display/display-live'
import type { DisplayWidgetContent } from '@vynel/contracts/display/display-widget-content'
import type { DisplayLiveSink } from './display-live-sink.js'

export function seedUser(db: Database, displayName = 'Dana'): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName,
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

export function markdownContent(body = '# Hello'): DisplayWidgetContent {
  return { kind: 'markdown', body }
}

// `drizzle()` returns `BetterSQLite3Database & { $client }`, but the kernel's
// `Database` alias keeps only the first half — so the connection is reached
// structurally rather than by widening a kernel type for a test.
function isInTransaction(db: Database): boolean {
  return (db as unknown as { $client: { inTransaction: boolean } }).$client.inTransaction
}

/** Records the frames it was handed AND whether the connection still had a
 *  transaction open when each arrived.
 *
 *  Reading the board back from inside `publish` would prove nothing:
 *  better-sqlite3 is one synchronous connection, so a read issued inside
 *  `db.transaction(...)` already sees the uncommitted row. `inTransaction` is
 *  what actually discriminates — it flips to false only once the commit lands,
 *  so `sawOpenTransaction` fails the moment a publish moves inside a tx. */
export function createRecordingSink(db: Database): DisplayLiveSink & {
  frames: DisplayLiveFrame[]
  sawOpenTransaction: boolean
} {
  const sink = {
    frames: [] as DisplayLiveFrame[],
    sawOpenTransaction: false,
    publish(frame: DisplayLiveFrame) {
      if (isInTransaction(db)) sink.sawOpenTransaction = true
      sink.frames.push(frame)
    },
  }
  return sink
}

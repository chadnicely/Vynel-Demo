// Functional repository for `display_widgets`. `db` is the first argument;
// Phase 1 SYNC returns. No Drizzle queries outside this file.
//
// Every read and write is scoped by `userId` — ownership is a WHERE clause,
// not a check a caller can forget, so a widget belonging to someone else is
// indistinguishable from one that never existed.

import { and, asc, count, desc, eq, isNotNull, lte } from 'drizzle-orm'
import { NotFoundError } from '@vynel/errors'
import { DISPLAY_WIDGET_SLOTS } from '@vynel/contracts/display/display-widget-content'
import { displayWidgets } from '../schema/display-widgets.js'
import type { Database } from '@vynel/db'
import type { DisplayWidgetSlot } from '@vynel/contracts/display/display-widget-content'
import type { DisplayWidgetRow, NewDisplayWidget } from '../schema/display-widgets.js'

export type { DisplayWidgetRow, NewDisplayWidget } from '../schema/display-widgets.js'

export interface DisplayWidgetRef {
  userId: string
  widgetId: string
}

export interface DisplayScopeRef {
  userId: string
  scopeKey: string
}

export function insertDisplayWidget(db: Database, row: NewDisplayWidget): DisplayWidgetRow {
  const [inserted] = db.insert(displayWidgets).values(row).returning().all()
  if (!inserted) throw new Error('insertDisplayWidget: no row returned')
  return inserted
}

export function findDisplayWidget(db: Database, ref: DisplayWidgetRef): DisplayWidgetRow | null {
  const [row] = db
    .select()
    .from(displayWidgets)
    .where(and(eq(displayWidgets.id, ref.widgetId), eq(displayWidgets.userId, ref.userId)))
    .limit(1)
    .all()
  return row ?? null
}

export function getDisplayWidgetOrThrow(db: Database, ref: DisplayWidgetRef): DisplayWidgetRow {
  const row = findDisplayWidget(db, ref)
  if (!row) throw new NotFoundError('Display widget', ref.widgetId)
  return row
}

/** The scope's board, slot by slot in reading order, then by position within
 *  the slot. SQL orders on `(sortOrder, id)` — index-aligned and deterministic
 *  — and the slot rank is applied here, because `sortOrder` repeats across
 *  slots and text-sorting the slot column would read `dock, left, right,
 *  stage`, which is meaningless. */
export function listDisplayWidgetsForScope(db: Database, scope: DisplayScopeRef): DisplayWidgetRow[] {
  const rows = db
    .select()
    .from(displayWidgets)
    .where(
      and(eq(displayWidgets.userId, scope.userId), eq(displayWidgets.scopeKey, scope.scopeKey)),
    )
    .orderBy(asc(displayWidgets.sortOrder), asc(displayWidgets.id))
    .all()
  return rows.sort(
    (left, right) => DISPLAY_WIDGET_SLOTS.indexOf(left.slot) - DISPLAY_WIDGET_SLOTS.indexOf(right.slot),
  )
}

export function updateDisplayWidget(
  db: Database,
  ref: DisplayWidgetRef,
  patch: Partial<NewDisplayWidget>,
): DisplayWidgetRow {
  const [updated] = db
    .update(displayWidgets)
    .set(patch)
    .where(and(eq(displayWidgets.id, ref.widgetId), eq(displayWidgets.userId, ref.userId)))
    .returning()
    .all()
  if (!updated) throw new NotFoundError('Display widget', ref.widgetId)
  return updated
}

export function deleteDisplayWidget(db: Database, ref: DisplayWidgetRef): DisplayWidgetRow | null {
  const [deleted] = db
    .delete(displayWidgets)
    .where(and(eq(displayWidgets.id, ref.widgetId), eq(displayWidgets.userId, ref.userId)))
    .returning()
    .all()
  return deleted ?? null
}

export function deleteDisplayWidgetsByScope(
  db: Database,
  scope: DisplayScopeRef,
): DisplayWidgetRow[] {
  return db
    .delete(displayWidgets)
    .where(
      and(eq(displayWidgets.userId, scope.userId), eq(displayWidgets.scopeKey, scope.scopeKey)),
    )
    .returning()
    .all()
}

export function countDisplayWidgetsByScope(db: Database, scope: DisplayScopeRef): number {
  const [row] = db
    .select({ value: count() })
    .from(displayWidgets)
    .where(
      and(eq(displayWidgets.userId, scope.userId), eq(displayWidgets.scopeKey, scope.scopeKey)),
    )
    .all()
  return row?.value ?? 0
}

/** The eviction candidate — the scope's oldest card. Ties on `createdAt` break
 *  on `id` so a burst of same-millisecond adds still evicts deterministically. */
export function findOldestDisplayWidgetInScope(
  db: Database,
  scope: DisplayScopeRef,
): DisplayWidgetRow | null {
  const [row] = db
    .select()
    .from(displayWidgets)
    .where(
      and(eq(displayWidgets.userId, scope.userId), eq(displayWidgets.scopeKey, scope.scopeKey)),
    )
    .orderBy(asc(displayWidgets.createdAt), asc(displayWidgets.id))
    .limit(1)
    .all()
  return row ?? null
}

/** Highest `sortOrder` currently held in one slot of one scope; -1 when the
 *  slot is empty, so `max + 1` starts a fresh slot at 0. */
export function maxSortOrderInSlot(
  db: Database,
  scope: DisplayScopeRef & { slot: DisplayWidgetSlot },
): number {
  const [row] = db
    .select({ sortOrder: displayWidgets.sortOrder })
    .from(displayWidgets)
    .where(
      and(
        eq(displayWidgets.userId, scope.userId),
        eq(displayWidgets.scopeKey, scope.scopeKey),
        eq(displayWidgets.slot, scope.slot),
      ),
    )
    .orderBy(desc(displayWidgets.sortOrder))
    .limit(1)
    .all()
  return row?.sortOrder ?? -1
}

/** Delete every widget already past its `expiresAt`, returning the rows so the
 *  caller can emit one removed event per card. Unscoped by default — the boot
 *  pass sweeps process-wide (the `listAllPendingAskRequests` precedent); the
 *  lazy list sweep narrows to the scope it is about to read. */
export function deleteExpiredDisplayWidgets(
  db: Database,
  input: { now: Date; userId?: string | undefined; scopeKey?: string | undefined },
): DisplayWidgetRow[] {
  const conditions = [isNotNull(displayWidgets.expiresAt), lte(displayWidgets.expiresAt, input.now)]
  if (input.userId !== undefined) conditions.push(eq(displayWidgets.userId, input.userId))
  if (input.scopeKey !== undefined) conditions.push(eq(displayWidgets.scopeKey, input.scopeKey))
  return db
    .delete(displayWidgets)
    .where(and(...conditions))
    .returning()
    .all()
}

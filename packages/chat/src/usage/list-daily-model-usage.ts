// Core op — the dashboard's usage-statistics read: token usage per model per
// local calendar day, over a bounded trailing window. Composes the repository
// read with the pure fold; both route twins (user-scoped `/dashboard/usage`
// and `/workspaces/:id/dashboard/usage`) call this one home.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import {
  foldDailyModelUsage,
  sinceForDayWindow,
  type DailyModelUsage,
} from './fold-daily-model-usage.js'

export type ListDailyModelUsageInput = {
  userId: string
  /** Trailing window in local calendar days, today included. */
  days?: number
  /** Restrict to one workspace's sessions; omit for the whole set. */
  workspaceId?: string
}

// Defensive cap at the core layer too — the HTTP boundary clamps
// independently (the D16 precedent).
const DEFAULT_DAYS = 30
const MAX_DAYS = 90

export function listDailyModelUsage(
  db: Database,
  input: ListDailyModelUsageInput,
): DailyModelUsage[] {
  const days = Math.max(1, Math.min(input.days ?? DEFAULT_DAYS, MAX_DAYS))
  const rows = chatRepository.listAssistantUsageRowsSince(db, {
    userId: input.userId,
    since: sinceForDayWindow(days, new Date()),
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
  })
  return foldDailyModelUsage(rows)
}

// The labels VYNEL ITSELF wears when it speaks in a chat on behalf of
// something that is not a session: a background job that died or reported
// nothing, the task list, a schedule, a monitor wake. Each producer composes
// its `reporterLabel` from HERE, and the UI reads the producer KIND back off
// the row's `sourceLabel` with `engineReporterKindOf` — so the icon a row
// wears (Kafi, 2026-08-26: "different kinds of background task, different
// icons, a default fallback") can never drift from what the engine wrote.
//
// Lives in contracts because both sides need the same strings: the
// orchestration/session leaves write them, the web reads them, and neither
// may import the other. The schedule prefix already lived here
// (`schedules/schedule-source-label.ts`); this file is the one index of all
// of them.

import { SCHEDULE_SOURCE_LABEL_PREFIX } from '../schedules/schedule-source-label.js'

/** A job with no persona of its own (a nameless session-target job) failed or
 *  ended without reporting — the engine relays for it under this name. */
export const BACKGROUND_TASK_REPORTER_LABEL = 'Background task'

/** The task list nudging a chat about a task the user filed. */
export const TASKS_REPORTER_LABEL = 'Tasks'

/** The prefix every monitor-wake label opens with ("Monitor · pnpm test"). */
export const MONITOR_SOURCE_LABEL_PREFIX = 'Monitor · '

/** The label a monitor wake wears as a message source. */
export function monitorSourceLabel(description: string): string {
  return `${MONITOR_SOURCE_LABEL_PREFIX}${description}`
}

export type EngineReporterKind = 'background-task' | 'tasks' | 'schedule' | 'monitor'

/** Which engine producer a row's `sourceLabel` names — null for a real
 *  session/persona label (the row is somebody speaking, not the engine). */
export function engineReporterKindOf(
  sourceLabel: string | null | undefined,
): EngineReporterKind | null {
  if (sourceLabel === null || sourceLabel === undefined) return null
  if (sourceLabel === BACKGROUND_TASK_REPORTER_LABEL) return 'background-task'
  if (sourceLabel === TASKS_REPORTER_LABEL) return 'tasks'
  if (sourceLabel.startsWith(SCHEDULE_SOURCE_LABEL_PREFIX)) return 'schedule'
  if (sourceLabel.startsWith(MONITOR_SOURCE_LABEL_PREFIX)) return 'monitor'
  return null
}

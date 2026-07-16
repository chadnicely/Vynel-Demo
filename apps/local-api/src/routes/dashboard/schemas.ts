// Zod response schema for the `dashboard` HTTP surface. API-internal —
// single consumer (this route) per `coding-standard.md` "Zod schemas". The
// aggregate mirrors the UI demo's `DashboardOverview` shape exactly
// (`apps/local-web/src/demo/demo-namespaces.ts`) — it is the requirements
// doc for this net-new route. Reuses the sibling routes' already-declared
// response shapes rather than redeclaring them (the `root/schemas.ts`
// precedent: cross-route schema reuse, one home per shape, no drift).

import { z } from 'zod'
import { WorkspaceResponseSchema } from '../workspaces/schemas.js'
import { ChatSessionListItemSchema } from '../chat/schemas.js'
import { ScheduleResponseSchema } from '../schedules/schemas.js'
import { TaskResponseSchema } from '../tasks/schemas.js'

export const DashboardOverviewResponseSchema = z.object({
  workspaces: z.array(WorkspaceResponseSchema),
  recentSessions: z.array(ChatSessionListItemSchema),
  upcomingSchedules: z.array(ScheduleResponseSchema),
  // The task-list card: everything still open/in-progress (newest first)
  // + the recently completed tail ("what Claude delivered").
  openTasks: z.array(TaskResponseSchema),
  recentlyCompletedTasks: z.array(TaskResponseSchema),
})

// The `dashboard` HTTP surface — ONE net-new route mounted at `/dashboard`
// (USER-scoped, no workspace prefix) from `apps/local-api/src/app.ts`:
//
//   GET /overview -> the Home landing aggregate [no x-mcp — UI-only read]
//
// No source route to port: this mirrors the UI demo's `DashboardOverview`
// aggregate (`apps/local-web/src/demo/demo-namespaces.ts`) so the real
// surface can replace the demo swap seam unchanged once `pnpm api:generate`
// runs. Pure assembly — three EXISTING core-op reads composed into one
// payload, no new business logic beyond the upcoming-schedules filter/sort
// (mirrors the demo's own `isEnabled && nextScheduledFireAt !== null`,
// soonest-first — "list + filter in the route" is the locked call when no
// query op spans this shape yet).
//
// Locked Hono protocol per `coding-standard.md` "Hono routes": describeRoute
// (from the local openapi.js wrapper) -> `...userScoped` -> handler on
// `factory.createApp()` (the root/workspaces precedent).

import { resolver, validator } from 'hono-openapi/zod'
import { listWorkspacesForUser } from '@vynel/workspaces'
import { listDailyModelUsage, listRecentChatSessionsForUser } from '@vynel/chat'
import { listSchedulesForUser } from '@vynel/schedules'
import type { Schedule } from '@vynel/schedules'
import { listTasksForUser } from '@vynel/tasks'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { serializeScheduleForResponse } from '../schedules/serializers.js'
import { serializeTaskForResponse } from '../tasks/serializers.js'
import {
  DashboardOverviewResponseSchema,
  DashboardUsageQuerySchema,
  DashboardUsageResponseSchema,
} from './schemas.js'

// The recent-activity feed size — mirrors the demo's `listRecentSessions(5)`.
const RECENT_SESSIONS_LIMIT = 5

// The completed tail on the Tasks card — enough to show "what Claude
// delivered" without the card scrolling forever.
const RECENTLY_COMPLETED_TASKS_LIMIT = 5

export const dashboardApp = factory
  .createApp()
  .get(
    '/overview',
    describeRoute({
      tags: ['dashboard'],
      summary:
        "Get the Home dashboard's aggregate read (workspaces + recent chat activity + upcoming schedules + tasks).",
      'x-sdk-name': 'dashboard.getOverview',
      responses: {
        200: {
          description:
            '{ workspaces, recentSessions, upcomingSchedules, openTasks, recentlyCompletedTasks }.',
          content: { 'application/json': { schema: resolver(DashboardOverviewResponseSchema) } },
        },
      },
      // No x-mcp — a UI landing read, not an agent tool surface.
    }),
    ...userScoped,
    async (c) => {
      const workspaces = await listWorkspacesForUser(c.var.db, { userId: c.var.user.id })
      const recentSessions = listRecentChatSessionsForUser(c.var.db, {
        userId: c.var.user.id,
        limit: RECENT_SESSIONS_LIMIT,
      })
      const schedules = listSchedulesForUser(c.var.db, { userId: c.var.user.id })
      const upcomingSchedules = schedules
        .filter(isUpcoming)
        .sort((a, b) => a.nextScheduledFireAt.getTime() - b.nextScheduledFireAt.getTime())
        .map(serializeScheduleForResponse)

      // Tasks span both scopes (the user-scoped read). Open + in-progress are
      // the live list (repo order: newest first); the completed tail is
      // re-sorted by completion time so "what Claude delivered" reads
      // most-recent-first regardless of when the task was created.
      const tasks = listTasksForUser(c.var.db, { userId: c.var.user.id })
      const openTasks = tasks
        .filter((t) => t.status !== 'done')
        .map((task) => serializeTaskForResponse(task))
      const recentlyCompletedTasks = tasks
        .filter((t) => t.status === 'done' && t.completedAt !== null)
        .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
        .slice(0, RECENTLY_COMPLETED_TASKS_LIMIT)
        .map((task) => serializeTaskForResponse(task))

      return c.json({
        workspaces,
        recentSessions,
        upcomingSchedules,
        openTasks,
        recentlyCompletedTasks,
      })
    },
  )
  // GET /usage — token usage per model per local day, spanning the user's
  // whole set (global root + every workspace). Workspace twin:
  // `workspace-scoped.ts`.
  .get(
    '/usage',
    describeRoute({
      tags: ['dashboard'],
      summary: 'Get token-usage statistics per model per day (all scopes).',
      'x-sdk-name': 'dashboard.getUsage',
      responses: {
        200: {
          description: '{ rows: [{ day, model, providerId, inputTokens, outputTokens, assistantMessageCount }] }.',
          content: { 'application/json': { schema: resolver(DashboardUsageResponseSchema) } },
        },
      },
      // No x-mcp — a UI statistics read, not an agent tool surface.
    }),
    validator('query', DashboardUsageQuerySchema),
    ...userScoped,
    (c) => {
      const { days } = c.req.valid('query')
      const rows = listDailyModelUsage(c.var.db, {
        userId: c.var.user.id,
        ...(days !== undefined ? { days } : {}),
      })
      return c.json({ rows })
    },
  )

// Enabled + has a next fire time — mirrors the demo fixture's own filter.
function isUpcoming(schedule: Schedule): schedule is Schedule & { nextScheduledFireAt: Date } {
  return schedule.isEnabled && schedule.nextScheduledFireAt !== null
}

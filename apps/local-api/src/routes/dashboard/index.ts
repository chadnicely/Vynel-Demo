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

import { resolver } from 'hono-openapi/zod'
import { listWorkspacesForUser } from '@vynel/workspaces'
import { listRecentChatSessionsForUser } from '@vynel/chat'
import { listSchedulesForUser } from '@vynel/schedules'
import type { Schedule } from '@vynel/schedules'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { serializeScheduleForResponse } from '../schedules/serializers.js'
import { DashboardOverviewResponseSchema } from './schemas.js'

// The recent-activity feed size — mirrors the demo's `listRecentSessions(5)`.
const RECENT_SESSIONS_LIMIT = 5

export const dashboardApp = factory
  .createApp()
  .get(
    '/overview',
    describeRoute({
      tags: ['dashboard'],
      summary:
        "Get the Home dashboard's aggregate read (workspaces + recent chat activity + upcoming schedules).",
      'x-sdk-name': 'dashboard.getOverview',
      responses: {
        200: {
          description: '{ workspaces, recentSessions, upcomingSchedules }.',
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

      return c.json({ workspaces, recentSessions, upcomingSchedules })
    },
  )

// Enabled + has a next fire time — mirrors the demo fixture's own filter.
function isUpcoming(schedule: Schedule): schedule is Schedule & { nextScheduledFireAt: Date } {
  return schedule.isEnabled && schedule.nextScheduledFireAt !== null
}

// The workspace brief's HTTP surface — mounted at `/workspaces/:workspaceId/brief`
// from `apps/local-api/src/app.ts`:
//
//   GET / -> findWorkspaceBrief   [x-mcp: get_workspace_brief]
//
// The brief is what the new-workspace wizard stored at Finish — the answers,
// the approved plan, and the text the user sent as the first message. It is
// the durable half of "feed the plan to the primary session" (the composer
// seed is the live half): a session that resumes days later re-reads the
// plan the user actually approved. Null = the workspace was not made by the
// wizard (pulled from a folder or a repository) — said plainly, never a 404.

import { resolver } from 'hono-openapi/zod'
import { findWorkspaceBrief, type WorkspaceBrief } from '@vynel/workspaces'
import type { WorkspaceBriefResponse } from '@vynel/contracts/workspaces/workspace-brief'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { GetWorkspaceBriefResponseSchema } from './wizard-schemas.js'

export function serializeWorkspaceBrief(brief: WorkspaceBrief): WorkspaceBriefResponse {
  return {
    workspaceId: brief.workspaceId,
    answers: brief.answers,
    plan: brief.plan,
    brief: brief.brief,
    createdAt: brief.createdAt.toISOString(),
  }
}

export const workspaceBriefApp = factory.createApp().get(
  '/',
  describeRoute({
    tags: ['workspaces'],
    summary: "The new-workspace wizard's approved plan for this workspace, if it was made by the wizard.",
    'x-sdk-name': 'workspaces.getBrief',
    responses: {
      200: {
        description: '{ brief } — null when the workspace was not made by the wizard.',
        content: { 'application/json': { schema: resolver(GetWorkspaceBriefResponseSchema) } },
      },
      404: { description: 'Workspace not found.' },
    },
    'x-mcp': {
      exposed: true,
      name: 'get_workspace_brief',
      description:
        "Read this workspace's brief — what the user agreed to when they set it up with the " +
        'new-workspace wizard: the answers they gave (the idea, who it is for, what it keeps ' +
        'track of, the wish list with where each item came from, the stack), the plan they ' +
        'approved (the one-liner, what to build, the MVP in a nutshell, the goals, and the build ' +
        'sessions IN ORDER with `mvp: false` marking what comes after the MVP), and the brief ' +
        'text they sent as the first message. `brief` is null when the workspace was not made ' +
        'by the wizard (pulled in from a folder or a repository). Read it before planning or ' +
        'resuming the build so the work stays the plan the user approved. Read-only.',
    },
  }),
  ...workspaceScoped,
  (c) => {
    const brief = findWorkspaceBrief(c.var.db, c.var.workspace!.id)
    return c.json({ brief: brief === null ? null : serializeWorkspaceBrief(brief) })
  },
)

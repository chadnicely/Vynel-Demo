// A workspace's GitHub repository — mounted at `/workspaces/:workspaceId/github`
// from `apps/local-api/src/app.ts`:
//
//   POST /repository -> githubConnection.createRepository   (no x-mcp)
//
// The wizard's Finish and the header's "Connect to GitHub" both land here:
// ONE `gh repo create --source <folder> --push` through the app's global
// GitHub sign-in. The outcome is always a 200 with `{ outcome }` — created
// (with the URL) or failed (with gh's reason) — because a repository that
// could not be made leaves the workspace fine. No x-mcp: a session runs
// `gh repo create` on Bash itself, under the approval card.

import { z } from 'zod'
import { resolver, validator } from 'hono-openapi/zod'
import {
  REPOSITORY_NAME_PATTERN,
  REPOSITORY_NAME_RULE,
} from '@vynel/contracts/github/github-repository'
import type { CreateGitHubRepositoryResponse } from '@vynel/contracts/github/github-repository'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'

export const CreateGitHubRepositoryRequestSchema = z.object({
  name: z.string().trim().regex(REPOSITORY_NAME_PATTERN, { message: REPOSITORY_NAME_RULE }),
  visibility: z.enum(['private', 'public']),
})

export const CreateGitHubRepositoryResponseSchema = z.object({
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('created'), url: z.string().nullable() }),
    z.object({ kind: z.literal('failed'), reason: z.string() }),
  ]),
})

export const workspaceGitHubApp = factory.createApp().post(
  '/repository',
  describeRoute({
    tags: ['workspaces'],
    summary:
      "Create a GitHub repository for this workspace's folder and push it, through the app's GitHub sign-in.",
    'x-sdk-name': 'workspaces.createGitHubRepository',
    responses: {
      200: {
        description:
          '{ outcome } — created (with the URL) or failed (with the reason: not signed in, name taken, no commits…).',
        content: { 'application/json': { schema: resolver(CreateGitHubRepositoryResponseSchema) } },
      },
      400: { description: 'Validation error.' },
      404: { description: 'Workspace not found.' },
    },
  }),
  validator('json', CreateGitHubRepositoryRequestSchema),
  ...workspaceScoped,
  async (c) => {
    const { name, visibility } = c.req.valid('json')
    const outcome = await c.var.githubConnection.createRepository({
      directory: c.var.workspace!.path,
      name,
      visibility,
    })
    const response: CreateGitHubRepositoryResponse = { outcome }
    return c.json(response)
  },
)

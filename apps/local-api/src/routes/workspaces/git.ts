// A workspace folder's git facts — mounted at `/workspaces/:workspaceId/git`
// from `apps/local-api/src/app.ts`:
//
//   GET / -> readGitFacts + listBranches + listWorktrees   [x-mcp: get_workspace_git_facts]
//
// Read fresh from git every time (never cached in the DB — the sessions
// commit and branch on Bash without telling Vynel). A plain folder, a
// missing folder or a machine without git are normal answers, never 4xx.

import { z } from 'zod'
import { resolver } from 'hono-openapi/zod'
import { listBranches, listWorktrees, readGitFacts } from '@vynel/workspaces'
import type { WorkspaceGitResponse } from '@vynel/contracts/workspaces/workspace-git'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'

const GitFactsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no-git') }),
  z.object({ kind: z.literal('folder-missing') }),
  z.object({ kind: z.literal('not-a-repository') }),
  z.object({ kind: z.literal('unreadable'), reason: z.string() }),
  z.object({
    kind: z.literal('repository'),
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
    changedCount: z.number().int(),
    untrackedCount: z.number().int(),
    remoteUrl: z.string().nullable(),
  }),
])

export const WorkspaceGitResponseSchema = z.object({
  facts: GitFactsSchema,
  branches: z.array(
    z.object({ name: z.string(), isCurrent: z.boolean(), upstream: z.string().nullable() }),
  ),
  worktrees: z.array(
    z.object({ path: z.string(), branch: z.string().nullable(), isMain: z.boolean() }),
  ),
})

export const workspaceGitApp = factory.createApp().get(
  '/',
  describeRoute({
    tags: ['workspaces'],
    summary:
      "This workspace folder's git facts: branch, upstream distance, uncommitted work, remote, branches, worktrees.",
    'x-sdk-name': 'workspaces.getGit',
    responses: {
      200: {
        description:
          '{ facts, branches, worktrees } — facts.kind says whether there is a repository at all.',
        content: { 'application/json': { schema: resolver(WorkspaceGitResponseSchema) } },
      },
      404: { description: 'Workspace not found.' },
    },
    'x-mcp': {
      exposed: true,
      name: 'get_workspace_git_facts',
      description:
        "Read what git knows about this workspace's folder, fresh: `facts.kind` is 'repository' " +
        '(with the current branch, its upstream and how many commits ahead/behind, the count of ' +
        "changed and untracked files, and the origin address), 'not-a-repository' (a plain " +
        "folder — no git yet), 'folder-missing', 'no-git' (git is not installed), or " +
        "'unreadable' (git's own reason). `branches` lists the local branches with the " +
        'checked-out one marked; `worktrees` lists every checkout of the repository, the ' +
        "main one first, then every linked worktree (the sessions' `.claude/worktrees/<slug>` " +
        'folders among them). Use it ' +
        'before deciding where to work or whether there is uncommitted work to protect. ' +
        'Read-only — it never changes the repository.',
    },
  }),
  ...workspaceScoped,
  async (c) => {
    const directory = c.var.workspace!.path
    const facts = await readGitFacts(directory)
    const isRepository = facts.kind === 'repository'
    const response: WorkspaceGitResponse = {
      facts,
      branches: isRepository ? await listBranches(directory) : [],
      worktrees: isRepository ? await listWorktrees(directory) : [],
    }
    return c.json(response)
  },
)

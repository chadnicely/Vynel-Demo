// The `workspaces` HTTP surface — fifteen routes mounted at `/workspaces`
// (USER-scoped, no `:workspaceId` prefix) from `apps/local-api/src/app.ts`:
//   - GET    /workspaces                        -> listWorkspacesForUser  [x-mcp]
//   - POST   /workspaces                        -> createWorkspace
//   - POST   /workspaces/pick-folder             -> pickFolderWithNativeDialog
//   - GET    /workspaces/scan-folder             -> scanFolderForProjects
//   - GET    /workspaces/directories             -> listChildDirectories
//   - POST   /workspaces/directories             -> createChildDirectory
//   - GET    /workspaces/groups                 -> listWorkspaceGroups    [x-mcp]
//   - POST   /workspaces/groups                 -> createWorkspaceGroup
//   - PATCH  /workspaces/groups/:groupId        -> renameWorkspaceGroup
//   - DELETE /workspaces/groups/:groupId        -> deleteWorkspaceGroup
//   - GET    /workspaces/statuses               -> status facts (Arc 5b)
//   - GET    /workspaces/:workspaceId           -> c.var.workspace        [x-mcp]
//   - PATCH  /workspaces/:workspaceId           -> updateWorkspaceMetadata
//   - PUT    /workspaces/:workspaceId/group     -> setWorkspaceGroup
//   - PUT    /workspaces/:workspaceId/status    -> setWorkspaceStatus     [x-mcp]
//   - POST   /workspaces/:workspaceId/archive   -> archiveWorkspace
//   - POST   /workspaces/:workspaceId/unarchive -> unarchiveWorkspace
//   - DELETE /workspaces/:workspaceId           -> hardDeleteWorkspace
//
// Locked Hono protocol: `describeRoute` from `apps/local-api/src/openapi.js`,
// `validator` from `hono-openapi/zod` (registers each Zod schema with
// the OpenAPI spec so the SDK generator picks up request bodies +
// query/path params), chained methods on `factory.createApp()`. The
// two GET routes opt into MCP via `x-mcp`
// (safe-by-default reads); the mutating routes defer MCP exposure
// pending scope review. Per `.claude/rules/coding-standard.md` "Hono
// routes" + `.claude/rules/sdk-mcp.md`.
//
// The `:workspaceId` routes compose `...workspaceScoped`, whose
// `workspaceResolverMiddleware` resolves + ownership-checks the workspace
// and sets `c.var.workspace` (or throws NotFoundError). `c.var.workspace`
// is typed optional on `AppEnv`; the `!` in these handlers is sound — the
// bundle guarantees it is set. The `/`, POST `/`, and `/directories` routes
// compose `...userScoped` only — they act on the whole user, not one
// workspace.
//
// Error mapping: NONE here. Core ops throw typed `VynelError` subclasses;
// the global `onError` middleware in `app.ts` has a single
// `instanceof VynelError` check per `error-handling.md` "Layering".

import { resolver, validator } from 'hono-openapi/zod'
import type { WorkspaceGroupResponse } from '@vynel/contracts/workspaces/workspace-http'
import type { WorkspaceStatusReport } from '@vynel/contracts/workspaces/workspace-status'
import { listLatestWorkspaceTurnsForUser } from '@vynel/session/runtime'
import { countTasksByWorkspace } from '@vynel/tasks'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { serializeWorkspaceForResponse } from './serialize-workspace.js'
import {
  createWorkspace,
  listWorkspacesForUser,
  updateWorkspaceMetadata,
  archiveWorkspace,
  unarchiveWorkspace,
  hardDeleteWorkspace,
  listChildDirectories,
  createChildDirectory,
  pickFolderWithNativeDialog,
  scanFolderForProjects,
  createWorkspaceGroup,
  listWorkspaceGroups,
  renameWorkspaceGroup,
  deleteWorkspaceGroup,
  setWorkspaceGroup,
  setWorkspaceStatus,
} from '@vynel/workspaces'
import type { WorkspaceGroup } from '@vynel/workspaces'
import {
  CreateWorkspaceRequestSchema,
  PickFolderResponseSchema,
  ScanFolderQuerySchema,
  ScanFolderResponseSchema,
  UpdateWorkspaceRequestSchema,
  DeleteWorkspaceRequestSchema,
  ListWorkspacesQuerySchema,
  BrowseDirectoriesQuerySchema,
  WorkspaceResponseSchema,
  ListWorkspacesResponseSchema,
  DirectoryListingResponseSchema,
  DirectoryEntryResponseSchema,
  CreateDirectoryRequestSchema,
  CreateWorkspaceGroupRequestSchema,
  RenameWorkspaceGroupRequestSchema,
  SetWorkspaceGroupRequestSchema,
  SetWorkspaceStatusRequestSchema,
  WorkspaceGroupResponseSchema,
  ListWorkspaceGroupsResponseSchema,
  ListWorkspaceStatusesResponseSchema,
} from './schemas.js'

export const workspacesApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['workspaces'],
      summary: "List the user's workspaces, ordered by recency.",
      'x-sdk-name': 'workspaces.list',
      responses: {
        200: {
          description: 'Array of workspaces.',
          content: { 'application/json': { schema: resolver(ListWorkspacesResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_workspaces',
        description:
          "List the authenticated user's workspaces, most-recently-accessed first. " +
          'Archived workspaces are excluded unless includeArchived is true. Read-only.',
      },
    }),
    validator('query', ListWorkspacesQuerySchema),
    ...userScoped,
    async (c) => {
      const query = c.req.valid('query')
      // Conditional assembly — exactOptionalPropertyTypes rejects an
      // explicit `field: undefined` against an optional field.
      const workspaces = await listWorkspacesForUser(c.var.db, {
        userId: c.var.user.id,
        ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      })
      return c.json(workspaces.map(serializeWorkspaceForResponse))
    },
  )
  .post(
    '/',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Register an existing directory as a workspace.',
      'x-sdk-name': 'workspaces.register',
      // A brain-surface tool (rootSurface) — the user sets up workspaces from the
      // global conversation, not from inside a workspace. Cards in ask mode only
      // (Chad 2026-07-26: dropped from the every-mode set — "ask mode gates;
      // auto and bypass, no approval").
      'x-mcp': {
        exposed: true,
        name: 'register_workspace',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        description:
          "Create a new workspace for the user — a project or business area (e.g. 'Bookkeeping', " +
          "'Marketing site') the assistant works in, with its own files, chat, and tools. `name` is " +
          'the display name. `directory` is an EXISTING absolute folder path on disk that becomes the ' +
          "workspace root — confirm the exact path with the user first; the call fails if the folder " +
          "doesn't exist, isn't a directory, isn't writable, or is already a workspace. `kind` is " +
          'optional (personal / small-business / project / custom); `groupId` optionally files it ' +
          'into one of the user\'s workspace groups. Creating a workspace is a setup action the user ' +
          'approves. Returns the created workspace.',
      },
      responses: {
        201: {
          description: 'Workspace created.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        400: { description: 'Directory not found, not a directory, or not writable.' },
        404: { description: 'The group to file it into does not exist.' },
        409: { description: 'This directory is already a workspace.' },
      },
    }),
    validator('json', CreateWorkspaceRequestSchema),
    ...userScoped,
    async (c) => {
      // `kind` is optional in the request (the picker was retired — "stop
      // asking"); omit it when absent so the core default ('personal') applies.
      // Passing `kind: undefined` would trip exactOptionalPropertyTypes.
      const { kind, groupId, ...rest } = c.req.valid('json')
      const workspace = await createWorkspace(
        c.var.db,
        {
          ...rest,
          userId: c.var.user.id,
          ...(kind === undefined ? {} : { kind }),
          ...(groupId === undefined ? {} : { groupId }),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeWorkspaceForResponse(workspace), 201)
    },
  )
  // The ONE Browse button — opens the operating system's own choose-a-folder
  // window (Chad, 2026-08-24: people know this dialog from every other program
  // they use). A POST: a dialog on the user's screen is a side effect, and the
  // request parks until they answer. The dialog opens wherever the ENGINE
  // runs — the user's own machine today; if the engine ever moves to a server
  // this route must give way to the desktop shell's own dialog.
  .post(
    '/pick-folder',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Open the OS folder dialog and return what the user picked.',
      'x-sdk-name': 'workspaces.pickFolder',
      responses: {
        200: {
          description:
            'The chosen absolute path, or null — cancelling is a normal answer, never an error.',
          content: { 'application/json': { schema: resolver(PickFolderResponseSchema) } },
        },
      },
      // No x-mcp — an agent must never pop a dialog on the user's screen.
    }),
    ...userScoped,
    async (c) => c.json({ path: await pickFolderWithNativeDialog() }),
  )
  // "Which project?" — look inside the folder the user pointed at and say what
  // is in there. Read-only: it looks, it never adopts — adding is still the
  // create call. Static segment, registered before `/:workspaceId`.
  .get(
    '/scan-folder',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Say whether a folder IS a project, HOLDS projects, or neither.',
      'x-sdk-name': 'workspaces.scanFolder',
      responses: {
        200: {
          description:
            'single (adopt it) / several (the user ticks which) / none (offer "add it anyway").',
          content: { 'application/json': { schema: resolver(ScanFolderResponseSchema) } },
        },
        400: { description: 'Path not found, not a directory, or not readable.' },
      },
      // No x-mcp — a picker's read, not an agent tool.
    }),
    validator('query', ScanFolderQuerySchema),
    ...userScoped,
    async (c) => c.json(await scanFolderForProjects(c.req.valid('query').path)),
  )
  // Registered before `/:workspaceId` so the static segment wins (mirrors
  // chat's `/sessions/search`). Backs the workspace folder picker.
  .get(
    '/directories',
    describeRoute({
      tags: ['workspaces'],
      summary: 'List a local folder (subfolders, drives, known places) — backs the filesystem browser.',
      'x-sdk-name': 'workspaces.listDirectories',
      responses: {
        200: {
          description: 'A directory listing (path, parent, child directories, drives, known places).',
          content: { 'application/json': { schema: resolver(DirectoryListingResponseSchema) } },
        },
        400: { description: 'Path not found, not a directory, or not readable.' },
      },
      // No x-mcp — local filesystem browse, not an agent tool surface.
    }),
    validator('query', BrowseDirectoriesQuerySchema),
    ...userScoped,
    async (c) => {
      const { path: queryPath, includeFiles } = c.req.valid('query')
      return c.json(
        await listChildDirectories(queryPath, {
          ...(includeFiles === true ? { includeFiles } : {}),
          logger: c.var.logger,
        }),
      )
    },
  )
  // The browser's "New folder" — makes ONE folder inside an existing one and
  // returns its entry; the client re-lists and highlights it.
  .post(
    '/directories',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Create one new folder inside an existing local folder — the filesystem browser\'s "New folder".',
      'x-sdk-name': 'workspaces.createDirectory',
      responses: {
        201: {
          description: 'The new folder (name + absolute path).',
          content: { 'application/json': { schema: resolver(DirectoryEntryResponseSchema) } },
        },
        400: { description: 'Parent not found / not a directory, or the name is not a valid folder name.' },
        409: { description: 'A folder with that name already exists there.' },
      },
      // No x-mcp — local filesystem edit for the picker, not an agent tool surface.
    }),
    validator('json', CreateDirectoryRequestSchema),
    ...userScoped,
    async (c) => {
      const { parentPath, name } = c.req.valid('json')
      return c.json(await createChildDirectory(parentPath, name), 201)
    },
  )
  // ── Menu-tree folders (workspace redesign Arc 2b). Registered before
  // `/:workspaceId` so the static `groups` segment wins (the `/directories`
  // precedent). Mutations defer MCP exposure like the workspace mutations. ──
  .get(
    '/groups',
    describeRoute({
      tags: ['workspaces'],
      summary: "List the user's workspace folders (menu-tree groups), creation order.",
      'x-sdk-name': 'workspaces.listGroups',
      responses: {
        200: {
          description: 'Array of workspace folders.',
          content: { 'application/json': { schema: resolver(ListWorkspaceGroupsResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_workspace_groups',
        description:
          "List the authenticated user's workspace folders — the groups that organize " +
          'workspaces in the navigation tree. Membership is each workspace\'s groupId. Read-only.',
      },
    }),
    ...userScoped,
    async (c) => {
      const groups = await listWorkspaceGroups(c.var.db, c.var.user.id)
      return c.json(groups.map(serializeWorkspaceGroupForResponse))
    },
  )
  .post(
    '/groups',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Create a workspace folder.',
      'x-sdk-name': 'workspaces.createGroup',
      responses: {
        201: {
          description: 'Folder created.',
          content: { 'application/json': { schema: resolver(WorkspaceGroupResponseSchema) } },
        },
        400: { description: 'Empty or over-long folder name.' },
      },
    }),
    validator('json', CreateWorkspaceGroupRequestSchema),
    ...userScoped,
    async (c) => {
      const input = c.req.valid('json')
      const group = await createWorkspaceGroup(c.var.db, {
        userId: c.var.user.id,
        name: input.name,
      })
      return c.json(serializeWorkspaceGroupForResponse(group), 201)
    },
  )
  .patch(
    '/groups/:groupId',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Rename a workspace folder (owner-scoped — 404 if not owned).',
      'x-sdk-name': 'workspaces.renameGroup',
      responses: {
        200: {
          description: 'Renamed folder.',
          content: { 'application/json': { schema: resolver(WorkspaceGroupResponseSchema) } },
        },
        404: { description: 'Folder not found.' },
      },
    }),
    validator('json', RenameWorkspaceGroupRequestSchema),
    ...userScoped,
    async (c) => {
      const input = c.req.valid('json')
      const group = await renameWorkspaceGroup(c.var.db, {
        userId: c.var.user.id,
        groupId: c.req.param('groupId'),
        name: input.name,
      })
      return c.json(serializeWorkspaceGroupForResponse(group))
    },
  )
  .delete(
    '/groups/:groupId',
    describeRoute({
      tags: ['workspaces'],
      summary:
        'Delete a workspace folder. Member workspaces detach to the tree root — never deleted.',
      'x-sdk-name': 'workspaces.deleteGroup',
      responses: {
        204: { description: 'Folder deleted; members detached.' },
        404: { description: 'Folder not found.' },
      },
    }),
    ...userScoped,
    async (c) => {
      await deleteWorkspaceGroup(c.var.db, {
        userId: c.var.user.id,
        groupId: c.req.param('groupId'),
      })
      return c.body(null, 204)
    },
  )
  // ── Workspace statuses (redesign Arc 5b) — the FACTS the effective status
  // derives from, one row per workspace: the assistant-set state, the latest
  // turn envelope (failed/orphaned = the problem signal), and the task
  // rollup. Static segment, registered before `/:workspaceId`. The app layer
  // composes the three leaves (workspaces + session + tasks) — no leaf
  // imports a sibling. ──
  .get(
    '/statuses',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Per-workspace status facts: set state, latest turn, task counts.',
      'x-sdk-name': 'workspaces.listStatuses',
      responses: {
        200: {
          description: 'One status report per workspace.',
          content: {
            'application/json': { schema: resolver(ListWorkspaceStatusesResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    async (c) => {
      const rows = await listWorkspacesForUser(c.var.db, { userId: c.var.user.id })
      const latestTurns = listLatestWorkspaceTurnsForUser(c.var.db, c.var.user.id)
      const taskCounts = new Map(
        countTasksByWorkspace(c.var.db, { userId: c.var.user.id }).map((entry) => [
          entry.workspaceId,
          entry,
        ]),
      )
      const reports: WorkspaceStatusReport[] = rows.map((workspace) => {
        const turn = latestTurns.get(workspace.id)
        const counts = taskCounts.get(workspace.id)
        return {
          workspaceId: workspace.id,
          setStatus: workspace.status,
          statusNote: workspace.statusNote,
          statusSetAt: workspace.statusSetAt?.toISOString() ?? null,
          latestTurn: turn
            ? {
                startedAt: turn.startedAt.toISOString(),
                endedAt: turn.endedAt?.toISOString() ?? null,
                endedReason: turn.endedReason,
              }
            : null,
          tasksTotal: counts?.total ?? 0,
          tasksDone: counts?.done ?? 0,
        }
      })
      return c.json(reports)
    },
  )
  .get(
    '/:workspaceId',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Get one workspace by id (owner-scoped — 404 if not owned).',
      'x-sdk-name': 'workspaces.get',
      responses: {
        200: {
          description: 'Workspace.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_workspace',
        description:
          'Get one workspace by id. Owner-scoped — returns 404 if the workspace does ' +
          'not exist OR is not owned by the caller (no enumeration leak). Read-only.',
      },
    }),
    ...workspaceScoped,
    (c) => c.json(serializeWorkspaceForResponse(c.var.workspace!)),
  )
  .patch(
    '/:workspaceId',
    describeRoute({
      tags: ['workspaces'],
      summary:
        'Update workspace metadata (name + manager persona + continue-mode toggle; path and kind are immutable).',
      'x-sdk-name': 'workspaces.update',
      responses: {
        200: {
          description: 'Updated workspace.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('json', UpdateWorkspaceRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const input = c.req.valid('json')
      // Conditional assembly — the Zod-inferred `field?: T | undefined`
      // does not fit the core op's `field?: T` under exactOptionalPropertyTypes.
      const updated = await updateWorkspaceMetadata(c.var.db, c.var.workspace!.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.managerName !== undefined ? { managerName: input.managerName } : {}),
        ...(input.continueEnabled !== undefined ? { continueEnabled: input.continueEnabled } : {}),
      })
      return c.json(serializeWorkspaceForResponse(updated))
    },
  )
  .put(
    '/:workspaceId/group',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Move a workspace into a folder (or to the tree root with null).',
      'x-sdk-name': 'workspaces.setGroup',
      responses: {
        200: {
          description: 'Updated workspace.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        404: { description: 'Workspace or folder not found.' },
      },
    }),
    validator('json', SetWorkspaceGroupRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const input = c.req.valid('json')
      const updated = await setWorkspaceGroup(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        groupId: input.groupId,
      })
      return c.json(serializeWorkspaceForResponse(updated))
    },
  )
  // The assistant's status write (redesign Arc 5b) — a self-tool, so no
  // askApproval: setting "completed / problem / needs input" is reporting,
  // not an irreversible action.
  .put(
    '/:workspaceId/status',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Set the workspace status (completed / problem / needs_input).',
      'x-sdk-name': 'workspaces.setStatus',
      responses: {
        200: {
          description: 'Updated workspace.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'set_workspace_status',
        mutatingApproved: true,
        description:
          "Set this workspace's status light — the state the user sees on every " +
          'navigation surface. Set `completed` when EVERY task on the list is done ' +
          '(do it before finishing your reply, so the user sees it before their next ' +
          'message). Set `problem` when you are stuck and cannot proceed without help. ' +
          'Set `needs_input` when you reached a conclusion or decision that needs the ' +
          "user's attention (approvals and questions are detected automatically — this " +
          'is for conclusions). Include a short `note` saying why. The status clears ' +
          'itself when the user sends the next message.',
      },
    }),
    validator('json', SetWorkspaceStatusRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const input = c.req.valid('json')
      const updated = await setWorkspaceStatus(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        status: input.status,
        note: input.note ?? null,
      })
      return c.json(serializeWorkspaceForResponse(updated))
    },
  )
  .post(
    '/:workspaceId/archive',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Archive a workspace (hide from the default list; the folder stays on disk).',
      'x-sdk-name': 'workspaces.archive',
      responses: {
        200: {
          description: 'Archived workspace.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const updated = await archiveWorkspace(c.var.db, c.var.workspace!.id)
      return c.json(serializeWorkspaceForResponse(updated))
    },
  )
  .post(
    '/:workspaceId/unarchive',
    describeRoute({
      tags: ['workspaces'],
      summary: 'Unarchive a workspace (restore it to the default list).',
      'x-sdk-name': 'workspaces.unarchive',
      responses: {
        200: {
          description: 'Unarchived workspace.',
          content: { 'application/json': { schema: resolver(WorkspaceResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const updated = await unarchiveWorkspace(c.var.db, c.var.workspace!.id)
      return c.json(serializeWorkspaceForResponse(updated))
    },
  )
  .delete(
    '/:workspaceId',
    describeRoute({
      tags: ['workspaces'],
      summary:
        'Hard-delete a workspace. The caller explicitly chooses whether to delete files on disk.',
      'x-sdk-name': 'workspaces.delete',
      responses: {
        204: { description: 'Workspace deleted.' },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('json', DeleteWorkspaceRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const input = c.req.valid('json')
      await hardDeleteWorkspace(
        c.var.db,
        { workspaceId: c.var.workspace!.id, deleteFilesFromDisk: input.deleteFilesFromDisk },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )

function serializeWorkspaceGroupForResponse(group: WorkspaceGroup): WorkspaceGroupResponse {
  return {
    id: group.id,
    userId: group.userId,
    name: group.name,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  }
}

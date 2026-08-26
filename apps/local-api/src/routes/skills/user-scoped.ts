// The top-level `skills` HTTP surface — mounted at `/skills` (NO workspace
// prefix) from `apps/local-api/src/app.ts`, alongside the workspace-scoped
// twin (`/workspaces/:workspaceId/skills`, the catalog + settings doors).
//
//   GET    /installed          -> the user-scope shelf (the GLOBAL view), synced with disk
//   POST   /                   -> create one of the user's own skills (SKILL.md from parts)
//   GET    /:skillId/files     -> the skill's files + one file's text (SKILL.md by default)
//   PUT    /:skillId/files     -> write one text file (create or replace)
//   DELETE /:skillId/files     -> delete one supporting file
//   DELETE /:skillId           -> uninstall the skill (folder + row)
//
// A skill is a FOLDER on disk (`<root>/<skillId>/SKILL.md` + supporting
// files); the row is bookkeeping (health, settings), refreshed from disk on
// every list. The doors address a skill by `skillId` + `{ scope,
// workspaceId? }` the way `/agents` does, so ONE tool name serves the global
// root and a workspace conversation alike.
//
// MCP: `create_skill`, `get_skill`, `write_skill_file`, `delete_skill_file`,
// `uninstall_skill` on the root + workspace-interactive surfaces only. The
// two DELETEs card in ask mode as every DELETE does.

import { resolver, validator } from 'hono-openapi/zod'
import {
  createOwnSkill,
  deleteSkillFile,
  getInstalledSkillByScopeOrThrow,
  listInstalledSkillsSynced,
  listSkillFiles,
  readSkillFile,
  uninstallSkill,
  writeSkillFile,
  SKILL_ENTRY_FILE,
} from '@vynel/skills'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { resolveScopeTarget, workspacePathOf } from '../_shared/resolve-scope-target.js'
import {
  CreateSkillRequestSchema,
  DeleteSkillFileQuerySchema,
  InstalledSkillRowSchema,
  ListInstalledSkillsResponseSchema,
  SkillFilesQuerySchema,
  SkillFilesResponseSchema,
  SkillIdParamSchema,
  SkillScopeQuerySchema,
  WriteSkillFileRequestSchema,
} from './schemas.js'
import { serializeInstalledSkillRow, serializeInstalledSkillWithDefinition } from './serializers.js'

const SKILL_SCOPE_ARGUMENTS =
  '`scope` is "user" (~/.claude/skills — available in every workspace) or "workspace" ' +
  '(<workspace>/.claude/skills; + `workspaceId`, defaults to the active workspace; on the global ' +
  'surface there is none, so pass it explicitly).'

export const skillsUserApp = factory
  .createApp()
  .get(
    '/installed',
    describeRoute({
      tags: ['skills'],
      summary: "List the user's USER-SCOPE installed skills (the global view), synced with disk.",
      'x-sdk-name': 'skillsUser.listInstalled',
      responses: {
        200: {
          description:
            'User-scope installs only (workspaceId null), each joined with its catalog definition.',
          content: { 'application/json': { schema: resolver(ListInstalledSkillsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    async (c) => {
      const list = await listInstalledSkillsSynced(c.var.db, {
        userId: c.var.user.id,
        workspace: null,
        provider: c.var.aiProvider,
        logger: c.var.logger,
      })
      return c.json(list.map(serializeInstalledSkillWithDefinition))
    },
  )
  .post(
    '/',
    describeRoute({
      tags: ['skills'],
      summary: "Create one of the user's own skills — a new folder with its SKILL.md.",
      'x-sdk-name': 'skills.create',
      'x-mcp': {
        exposed: true,
        name: 'create_skill',
        description:
          'Create a NEW skill — a folder Claude Code loads on demand when a task matches its ' +
          'description: <root>/.claude/skills/<skillId>/SKILL.md. `skillId` is kebab-case (e.g. ' +
          `"weekly-report"); ${SKILL_SCOPE_ARGUMENTS} \`description\` is the one line that tells ` +
          'Claude WHEN to use the skill (be specific — it is the trigger); `body` is the SKILL.md ' +
          'instructions in markdown. Add supporting files (references, templates, scripts) ' +
          'afterwards with write_skill_file. Refuses a name already installed or already on disk. ' +
          'Only create a skill when the user asked for one. Mutating.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        201: {
          description: 'The installed-skill row (source "user").',
          content: { 'application/json': { schema: resolver(InstalledSkillRowSchema) } },
        },
        400: { description: 'Bad name, description, body, or workspaceId missing for the workspace scope.' },
        404: { description: 'Workspace not found (or not owned by this user).' },
        409: { description: 'A skill with that name is already installed, or its folder already exists.' },
      },
    }),
    validator('json', CreateSkillRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, body)
      const created = await createOwnSkill(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: target.workspaceId,
          workspacePath: target.workspacePath ?? null,
          scope: target.scope,
          skillId: body.skillId,
          description: body.description,
          body: body.body,
        },
        { logger: c.var.logger },
      )
      return c.json(serializeInstalledSkillRow(created), 201)
    },
  )
  .get(
    '/:skillId/files',
    describeRoute({
      tags: ['skills'],
      summary: "One skill's files, plus the text of one of them (SKILL.md by default).",
      'x-sdk-name': 'skills.getFiles',
      'x-mcp': {
        exposed: true,
        name: 'get_skill',
        description:
          `Read an installed skill by \`skillId\`. ${SKILL_SCOPE_ARGUMENTS} Returns every file in ` +
          'the skill folder (relativePath, size, whether it is text) and the content of ONE text ' +
          'file — SKILL.md unless `relativePath` names another. Use it to see what a skill does ' +
          'before editing it, or to open a supporting file. Read-only.',
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        200: {
          description: 'The file list and the requested file.',
          content: { 'application/json': { schema: resolver(SkillFilesResponseSchema) } },
        },
        400: { description: 'The file is binary or too large to open as text, or the path is unsafe.' },
        404: { description: 'No such skill at that scope, no such file, or workspace not found.' },
      },
    }),
    validator('param', SkillIdParamSchema),
    validator('query', SkillFilesQuerySchema),
    ...userScoped,
    async (c) => {
      const { skillId } = c.req.valid('param')
      const query = c.req.valid('query')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, query)
      const row = getInstalledSkillByScopeOrThrow(c.var.db, {
        userId: c.var.user.id,
        workspaceId: target.workspaceId,
        skillId,
      })
      const files = listSkillFiles(row, target.workspacePath)
      const file = await readSkillFile(row, query.relativePath ?? SKILL_ENTRY_FILE, target.workspacePath)
      return c.json({ skillId: row.skillId, scope: row.scope, files, file })
    },
  )
  .put(
    '/:skillId/files',
    describeRoute({
      tags: ['skills'],
      summary: 'Create or replace one text file inside an installed skill.',
      'x-sdk-name': 'skills.writeFile',
      'x-mcp': {
        exposed: true,
        name: 'write_skill_file',
        description:
          `Write ONE text file into an installed skill's folder by \`skillId\`. ${SKILL_SCOPE_ARGUMENTS} ` +
          '`relativePath` is inside the skill folder (e.g. "references/style.md" — folders are ' +
          'created; no "..", no hidden names); `content` replaces the whole file. Writing ' +
          '"SKILL.md" must keep a frontmatter with `name: <skillId>` and a `description`, or ' +
          'Claude Code stops loading the skill. Read the file first with get_skill when editing. ' +
          'Mutating.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        200: {
          description: 'The file list after the write, with the written file.',
          content: { 'application/json': { schema: resolver(SkillFilesResponseSchema) } },
        },
        400: { description: 'Unsafe path, oversized content, or a SKILL.md that would not load.' },
        404: { description: 'No such skill at that scope, or workspace not found.' },
      },
    }),
    validator('param', SkillIdParamSchema),
    validator('json', WriteSkillFileRequestSchema),
    ...userScoped,
    async (c) => {
      const { skillId } = c.req.valid('param')
      const body = c.req.valid('json')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, body)
      const row = getInstalledSkillByScopeOrThrow(c.var.db, {
        userId: c.var.user.id,
        workspaceId: target.workspaceId,
        skillId,
      })
      await writeSkillFile(
        row,
        { relativePath: body.relativePath, content: body.content },
        target.workspacePath,
      )
      const files = listSkillFiles(row, target.workspacePath)
      const file = await readSkillFile(row, body.relativePath, target.workspacePath)
      return c.json({ skillId: row.skillId, scope: row.scope, files, file })
    },
  )
  .delete(
    '/:skillId/files',
    describeRoute({
      tags: ['skills'],
      summary: 'Delete one supporting file from an installed skill.',
      'x-sdk-name': 'skills.deleteFile',
      'x-mcp': {
        exposed: true,
        name: 'delete_skill_file',
        description:
          `Delete ONE supporting file from an installed skill by \`skillId\` and \`relativePath\`. ` +
          `${SKILL_SCOPE_ARGUMENTS} SKILL.md cannot be deleted this way — that is uninstall_skill. ` +
          'Irreversible.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        204: { description: 'Deleted (no body).' },
        400: { description: 'Unsafe path, or the entry file.' },
        404: { description: 'No such skill, no such file, or workspace not found.' },
      },
    }),
    validator('param', SkillIdParamSchema),
    validator('query', DeleteSkillFileQuerySchema),
    ...userScoped,
    async (c) => {
      const { skillId } = c.req.valid('param')
      const query = c.req.valid('query')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, query)
      const row = getInstalledSkillByScopeOrThrow(c.var.db, {
        userId: c.var.user.id,
        workspaceId: target.workspaceId,
        skillId,
      })
      await deleteSkillFile(row, query.relativePath, target.workspacePath)
      return c.body(null, 204)
    },
  )
  .delete(
    '/:skillId',
    describeRoute({
      tags: ['skills'],
      summary: 'Uninstall a skill at a scope — its folder and its row.',
      'x-sdk-name': 'skills.uninstallByScope',
      'x-mcp': {
        exposed: true,
        name: 'uninstall_skill',
        description:
          `Uninstall a skill by \`skillId\`. ${SKILL_SCOPE_ARGUMENTS} Removes the whole skill folder ` +
          'from disk (SKILL.md and every supporting file) and forgets it — the user\'s own, a ' +
          'discovered one, or a Marketplace install alike. Irreversible; confirm with the user ' +
          'unless they just asked for exactly this.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        204: { description: 'Uninstalled (no body).' },
        403: { description: 'The skill is system-installed.' },
        404: { description: 'No such skill at that scope, or workspace not found.' },
      },
    }),
    validator('param', SkillIdParamSchema),
    validator('query', SkillScopeQuerySchema),
    ...userScoped,
    async (c) => {
      const { skillId } = c.req.valid('param')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, c.req.valid('query'))
      const row = getInstalledSkillByScopeOrThrow(c.var.db, {
        userId: c.var.user.id,
        workspaceId: target.workspaceId,
        skillId,
      })
      await uninstallSkill(
        c.var.db,
        { userId: c.var.user.id, installedSkillId: row.id, ...workspacePathOf(target) },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )

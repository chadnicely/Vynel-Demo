// The `skills` HTTP surface — 8 routes mounted under
// `/workspaces/:workspaceId/skills` from `apps/local-api/src/app.ts`:
//
//   GET    /available                              -> listAvailableSkills          [x-mcp]
//   GET    /installed                              -> listInstalledSkillsForContext [x-mcp]
//   POST   /install                                -> installSkill
//   DELETE /installed/:installedSkillId            -> uninstallSkill
//   POST   /installed/:installedSkillId/enable     -> enableSkill
//   POST   /installed/:installedSkillId/disable    -> disableSkill
//   PATCH  /installed/:installedSkillId/settings   -> updateSkillSettings
//   POST   /synchronize                            -> synchronizeSkillsWithProvider
//
// Locked Hono protocol per `coding-standard.md` "Hono routes" +
// `sdk-mcp.md`: describeRoute (from the local openapi.js wrapper
// — widens the type for x-mcp + x-sdk-name) → validator (from
// hono-openapi/zod) → `...workspaceScoped` → handler. Chained
// methods on `factory.createApp()`.
//
// MCP exposure per D17: 2 safe-read GETs only. POST/DELETE/PATCH
// routes do NOT carry x-mcp; mutating exposure waits for an
// LLM-autonomy use case + per-route scope review per sdk-mcp.md
// "Safe-by-default".
//
// Error mapping: NONE here. Core ops throw typed `VynelError`
// subclasses; the global `onError` middleware in `app.ts` has a
// single `instanceof VynelError` check per `error-handling.md`
// "Layering".

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  listAvailableSkills,
  listInstalledSkillsForContext,
  installSkill,
  uninstallSkill,
  enableSkill,
  disableSkill,
  updateSkillSettings,
  synchronizeSkillsWithProvider,
} from '@vynel/skills'
import {
  InstallSkillRequestSchema,
  UpdateSkillSettingsRequestSchema,
  InstalledSkillIdParamSchema,
  ListAvailableSkillsResponseSchema,
  ListInstalledSkillsResponseSchema,
  InstalledSkillRowSchema,
  ResolvedSkillSettingsSchema,
  SynchronizeSkillsResponseSchema,
} from './schemas.js'
import {
  serializeVerifiedSkill,
  serializeInstalledSkillRow,
  serializeInstalledSkillWithDefinition,
} from './serializers.js'

export const skillsApp = factory
  .createApp()
  .get(
    '/available',
    describeRoute({
      tags: ['skills'],
      summary: 'List the Verified-skill catalog (available to install).',
      'x-sdk-name': 'skills.listAvailable',
      responses: {
        200: {
          description: 'Array of catalog entries (definitions only).',
          content: { 'application/json': { schema: resolver(ListAvailableSkillsResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_available_skills',
        description:
          'List the Verified-skill catalog the user can install (read-only). ' +
          "Returns each skill's id, display name, one-line description, " +
          'category, recommended scope, and settings schema. Use this when ' +
          'the user asks what skills exist or which to install. Does NOT ' +
          'modify state.',
      },
    }),
    ...workspaceScoped,
    (c) => {
      const skills = listAvailableSkills()
      return c.json(skills.map(serializeVerifiedSkill))
    },
  )
  .get(
    '/installed',
    describeRoute({
      tags: ['skills'],
      summary: 'List skills installed in this user+workspace context.',
      'x-sdk-name': 'skills.listInstalled',
      responses: {
        200: {
          description:
            'Each installed skill joined with its catalog definition (if any) + resolved settings.',
          content: { 'application/json': { schema: resolver(ListInstalledSkillsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_installed_skills',
        description:
          'List skills installed in the current user+workspace context (owner-scoped). ' +
          'Returns the union of user-scope (available across every workspace) + workspace-scope ' +
          '(this workspace only) entries, each with version, scope, isEnabled flag, install ' +
          'health, and resolved settings. Read-only — use this to know what skills the agent ' +
          'currently has available, not to install them.',
      },
    }),
    ...workspaceScoped,
    (c) => {
      const list = listInstalledSkillsForContext(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      return c.json(list.map(serializeInstalledSkillWithDefinition))
    },
  )
  .post(
    '/install',
    describeRoute({
      tags: ['skills'],
      summary: 'Install a Verified skill at user or workspace scope.',
      'x-sdk-name': 'skills.install',
      responses: {
        201: {
          description: 'The installed-skill row.',
          content: { 'application/json': { schema: resolver(InstalledSkillRowSchema) } },
        },
        400: { description: 'Invalid initial settings.' },
        404: { description: 'Skill or workspace not found.' },
        409: { description: 'Already installed at the requested scope.' },
      },
    }),
    validator('json', InstallSkillRequestSchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const input: Parameters<typeof installSkill>[1] = {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        workspacePath: c.var.workspace!.path,
        skillId: body.skillId,
        scope: body.scope,
      }
      if (body.initialSettings !== undefined) input.initialSettings = body.initialSettings
      const installed = await installSkill(c.var.db, input, { logger: c.var.logger })
      return c.json(serializeInstalledSkillRow(installed), 201)
    },
  )
  .delete(
    '/installed/:installedSkillId',
    describeRoute({
      tags: ['skills'],
      summary: 'Uninstall a skill (hard-delete + cascade per D13).',
      'x-sdk-name': 'skills.uninstall',
      responses: {
        204: { description: 'Uninstalled.' },
        403: { description: 'Skill is system-installed; uninstall blocked.' },
        404: { description: 'Installed-skill row not found OR owned by another user.' },
      },
    }),
    validator('param', InstalledSkillIdParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { installedSkillId } = c.req.valid('param')
      await uninstallSkill(
        c.var.db,
        {
          userId: c.var.user.id,
          installedSkillId,
          workspacePath: c.var.workspace!.path,
        },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
  .post(
    '/installed/:installedSkillId/enable',
    describeRoute({
      tags: ['skills'],
      summary: 'Enable an installed skill — rewrites files from current settings.',
      'x-sdk-name': 'skills.enable',
      responses: {
        200: {
          description: 'The updated installed-skill row.',
          content: { 'application/json': { schema: resolver(InstalledSkillRowSchema) } },
        },
        404: { description: 'Installed-skill row not found OR owned by another user.' },
      },
    }),
    validator('param', InstalledSkillIdParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { installedSkillId } = c.req.valid('param')
      const updated = await enableSkill(c.var.db, {
        userId: c.var.user.id,
        installedSkillId,
        workspacePath: c.var.workspace!.path,
      })
      return c.json(serializeInstalledSkillRow(updated))
    },
  )
  .post(
    '/installed/:installedSkillId/disable',
    describeRoute({
      tags: ['skills'],
      summary: 'Disable an installed skill — removes files from disk; preserves row + settings.',
      'x-sdk-name': 'skills.disable',
      responses: {
        200: {
          description: 'The updated installed-skill row.',
          content: { 'application/json': { schema: resolver(InstalledSkillRowSchema) } },
        },
        404: { description: 'Installed-skill row not found OR owned by another user.' },
      },
    }),
    validator('param', InstalledSkillIdParamSchema),
    ...workspaceScoped,
    async (c) => {
      const { installedSkillId } = c.req.valid('param')
      const updated = await disableSkill(c.var.db, {
        userId: c.var.user.id,
        installedSkillId,
        workspacePath: c.var.workspace!.path,
      })
      return c.json(serializeInstalledSkillRow(updated))
    },
  )
  .patch(
    '/installed/:installedSkillId/settings',
    describeRoute({
      tags: ['skills'],
      summary: 'Update settings on an installed skill — re-renders SKILL.md if enabled.',
      'x-sdk-name': 'skills.updateSettings',
      responses: {
        200: {
          description: 'The resolved settings (defaults merged with overrides).',
          content: { 'application/json': { schema: resolver(ResolvedSkillSettingsSchema) } },
        },
        400: { description: 'Invalid setting key or value.' },
        404: { description: 'Installed-skill row not found OR owned by another user.' },
      },
    }),
    validator('json', UpdateSkillSettingsRequestSchema),
    validator('param', InstalledSkillIdParamSchema),
    ...workspaceScoped,
    async (c) => {
      const body = c.req.valid('json')
      const { installedSkillId } = c.req.valid('param')
      const resolved = await updateSkillSettings(c.var.db, {
        userId: c.var.user.id,
        installedSkillId,
        workspacePath: c.var.workspace!.path,
        newSettings: body.newSettings,
      })
      return c.json(resolved)
    },
  )
  .post(
    '/synchronize',
    describeRoute({
      tags: ['skills'],
      summary: 'Reconcile installed skills with what the provider sees on disk.',
      'x-sdk-name': 'skills.synchronize',
      responses: {
        200: {
          description: '{ healthyCount, missingOnDiskCount, externalDiscoveredCount }.',
          content: { 'application/json': { schema: resolver(SynchronizeSkillsResponseSchema) } },
        },
      },
    }),
    ...workspaceScoped,
    async (c) => {
      const stats = await synchronizeSkillsWithProvider(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          workspacePath: c.var.workspace!.path,
          provider: c.var.aiProvider,
        },
        { logger: c.var.logger },
      )
      return c.json(stats)
    },
  )

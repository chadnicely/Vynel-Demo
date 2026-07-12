// The `agents` HTTP surface — mounted top-level at `/agents` from
// `apps/local-api/src/app.ts` (agents are owned by the user and may be
// user-scoped (workspaceId null) OR workspace-scoped, so they don't nest
// under `/workspaces/:workspaceId/`).
//
//   POST   /agents                  -> createAgent (source 'user')
//   GET    /agents?workspaceId=      -> listAgentsForWorkspace
//   GET    /agents/curated           -> the curated catalog (browse source)
//   POST   /agents/curated/install   -> installCuratedAgent (seed install)
//   GET    /agents/:slug             -> getAgentBySlugOrThrow
//   PATCH  /agents/:agentId          -> updateAgent
//   POST   /agents/:agentId/enable   -> updateAgent({ enabled })
//   DELETE /agents/:agentId          -> softDeleteAgent
//
// The curated routes power the Agents-panel "browse + install curated"
// surface. `POST /agents/install` from the *marketplace* (community
// agents) remains a separate unit — not here.
//
// Locked Hono protocol (`CLAUDE.md` "Hono routes"): describeRoute (the
// local openapi.js wrapper) → validator(s) (from hono-openapi/zod) →
// `...userScoped` → handler; chained methods on `factory.createApp()`.
//
// Auth/scope: `...userScoped` resolves `c.var.user` (the single local
// user in Phase 1). Workspace OWNERSHIP, when a workspaceId is involved,
// is verified at the route via `getWorkspaceById` (404 on not-found/
// not-owned — no enumeration leak). This keeps `@vynel/agents` free of
// cross-feature imports (cross-feature composition lives in apps/
// local-api, mirroring the capabilities-composer precedent).
//
// `x-mcp` is intentionally OFF for every route in this unit, mirroring
// the source decision (read-safe list/get are future candidates, pending
// per-route scope review — same posture as `approvals`' D16).
//
// Error mapping: NONE here. Core ops throw typed `VynelError`
// subclasses; the global `onError` middleware maps them.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  createAgent,
  updateAgent,
  softDeleteAgent,
  listAgentsForWorkspace,
  getAgentBySlugOrThrow,
  listAgentSkillIds,
  installCuratedAgent,
} from '@vynel/agents'
import { getWorkspaceById } from '@vynel/workspaces'
import { ValidationError } from '@vynel/errors'
import { CURATED_AGENT_CATALOG } from '@vynel/contracts/agents/curated-agents/curated-agent-catalog'
import {
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
  SetAgentEnabledRequestSchema,
  InstallCuratedAgentRequestSchema,
  AgentIdParamSchema,
  AgentSlugParamSchema,
  ListAgentsQuerySchema,
  AgentSlugQuerySchema,
  AgentWithSkillsSchema,
  ListAgentsResponseSchema,
  ListCuratedAgentsResponseSchema,
} from './schemas.js'
import { serializeAgent, serializeAgentWithSkills, serializeCuratedAgent } from './serializers.js'

export const agentsApp = factory
  .createApp()
  .post(
    '/',
    describeRoute({
      tags: ['agents'],
      summary: 'Create an agent (user-built; source "user").',
      'x-sdk-name': 'agents.create',
      responses: {
        201: {
          description: 'The created agent (with its preloaded skill ids).',
          content: { 'application/json': { schema: resolver(AgentWithSkillsSchema) } },
        },
        400: { description: 'Invalid body, or workspaceId missing for a workspace-scoped agent.' },
        404: { description: 'Workspace not found (workspace-scoped create).' },
        409: { description: 'An agent with that slug already exists at the requested scope.' },
      },
    }),
    validator('json', CreateAgentRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const userId = c.var.user.id

      let workspaceId: string | null = null
      if (body.scope === 'workspace') {
        const targetWorkspaceId = body.workspaceId
        if (!targetWorkspaceId) {
          throw new ValidationError('workspaceId is required when scope is "workspace".')
        }
        // 404 if the workspace doesn't exist OR isn't owned by the caller.
        await getWorkspaceById(c.var.db, targetWorkspaceId, userId)
        workspaceId = targetWorkspaceId
      }

      const input: Parameters<typeof createAgent>[1] = {
        userId,
        workspaceId,
        slug: body.slug,
        name: body.name,
        description: body.description,
        prompt: body.prompt,
        // Server-stamped — the public create route only ever produces
        // user-built agents. Curated (vynel) + marketplace (community)
        // agents arrive via their own install paths.
        source: 'user',
        trustTier: 'community',
      }
      if (body.icon !== undefined) input.icon = body.icon
      if (body.model !== undefined) input.model = body.model
      if (body.effort !== undefined) input.effort = body.effort
      if (body.permissionMode !== undefined) input.permissionMode = body.permissionMode
      if (body.background !== undefined) input.background = body.background
      if (body.allowedTools !== undefined) input.allowedTools = body.allowedTools
      if (body.disallowedTools !== undefined) input.disallowedTools = body.disallowedTools
      if (body.skillIds !== undefined) input.skillIds = body.skillIds

      const created = await createAgent(c.var.db, input, { logger: c.var.logger })
      const skillIds = await listAgentSkillIds(c.var.db, created.id)
      return c.json(serializeAgentWithSkills(created, skillIds), 201)
    },
  )
  .get(
    '/',
    describeRoute({
      tags: ['agents'],
      summary: 'List agents: user-scope ∪ a workspace, or user-scope only (no workspaceId).',
      'x-sdk-name': 'agents.list',
      responses: {
        200: {
          description:
            'Array of agents, newest first (user-scope ∪ the workspace when workspaceId is given; user-scope only when omitted — the global surface).',
          content: { 'application/json': { schema: resolver(ListAgentsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ListAgentsQuerySchema),
    ...userScoped,
    async (c) => {
      const { workspaceId } = c.req.valid('query')
      const userId = c.var.user.id
      // Verify ownership of the workspace before listing (global surface
      // passes no workspaceId — user-scope rows only, nothing to verify).
      if (workspaceId !== undefined) {
        await getWorkspaceById(c.var.db, workspaceId, userId)
      }
      const agents = await listAgentsForWorkspace(c.var.db, {
        userId,
        workspaceId: workspaceId ?? null,
      })
      return c.json(agents.map(serializeAgent))
    },
  )
  // Curated catalog routes are declared BEFORE `/:slug` so the static
  // segment `curated` is never read as a slug. (Hono's RegExpRouter
  // prioritizes static over param regardless of order; the ordering here
  // is for readability.)
  .get(
    '/curated',
    describeRoute({
      tags: ['agents'],
      summary: 'List the Vynel-curated agent catalog (the browse + install source).',
      'x-sdk-name': 'agents.listCurated',
      responses: {
        200: {
          description: 'The compiled-in curated agent catalog.',
          content: { 'application/json': { schema: resolver(ListCuratedAgentsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      return c.json(CURATED_AGENT_CATALOG.map(serializeCuratedAgent))
    },
  )
  .post(
    '/curated/install',
    describeRoute({
      tags: ['agents'],
      summary: 'Install a Vynel-curated agent from the catalog into a scope.',
      'x-sdk-name': 'agents.installCurated',
      responses: {
        201: {
          description: 'The installed agent (with its preloaded skill ids).',
          content: { 'application/json': { schema: resolver(AgentWithSkillsSchema) } },
        },
        400: { description: 'workspaceId missing for a workspace-scoped install.' },
        404: { description: 'Curated agent slug not found, or workspace not found.' },
        409: { description: 'An agent with that slug already exists at the requested scope.' },
      },
    }),
    validator('json', InstallCuratedAgentRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const userId = c.var.user.id

      let workspaceId: string | null = null
      if (body.scope === 'workspace') {
        if (!body.workspaceId) {
          throw new ValidationError('workspaceId is required when scope is "workspace".')
        }
        // 404 if the workspace doesn't exist OR isn't owned by the caller.
        await getWorkspaceById(c.var.db, body.workspaceId, userId)
        workspaceId = body.workspaceId
      }

      const installed = await installCuratedAgent(
        c.var.db,
        { userId, workspaceId, slug: body.slug },
        { logger: c.var.logger },
      )
      const skillIds = await listAgentSkillIds(c.var.db, installed.id)
      return c.json(serializeAgentWithSkills(installed, skillIds), 201)
    },
  )
  .get(
    '/:slug',
    describeRoute({
      tags: ['agents'],
      summary: 'Get one agent by slug within an exact scope.',
      'x-sdk-name': 'agents.getBySlug',
      responses: {
        200: {
          description: 'The agent (with its preloaded skill ids).',
          content: { 'application/json': { schema: resolver(AgentWithSkillsSchema) } },
        },
        404: { description: 'Agent or workspace not found.' },
      },
    }),
    validator('param', AgentSlugParamSchema),
    validator('query', AgentSlugQuerySchema),
    ...userScoped,
    async (c) => {
      const { slug } = c.req.valid('param')
      const { workspaceId } = c.req.valid('query')
      const userId = c.var.user.id

      let scopeWorkspaceId: string | null = null
      if (workspaceId !== undefined) {
        await getWorkspaceById(c.var.db, workspaceId, userId)
        scopeWorkspaceId = workspaceId
      }

      const agent = await getAgentBySlugOrThrow(c.var.db, {
        userId,
        workspaceId: scopeWorkspaceId,
        slug,
      })
      const skillIds = await listAgentSkillIds(c.var.db, agent.id)
      return c.json(serializeAgentWithSkills(agent, skillIds))
    },
  )
  .patch(
    '/:agentId',
    describeRoute({
      tags: ['agents'],
      summary: 'Update an agent (persona, runtime, tools, preloaded skills).',
      'x-sdk-name': 'agents.update',
      responses: {
        200: {
          description: 'The updated agent.',
          content: { 'application/json': { schema: resolver(AgentWithSkillsSchema) } },
        },
        404: { description: 'Agent not found OR owned by another user.' },
        409: { description: 'Renamed slug collides with an existing agent at this scope.' },
      },
    }),
    validator('json', UpdateAgentRequestSchema),
    validator('param', AgentIdParamSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const { agentId } = c.req.valid('param')

      const input: Parameters<typeof updateAgent>[1] = { agentId, userId: c.var.user.id }
      if (body.slug !== undefined) input.slug = body.slug
      if (body.name !== undefined) input.name = body.name
      if (body.description !== undefined) input.description = body.description
      if (body.prompt !== undefined) input.prompt = body.prompt
      if (body.icon !== undefined) input.icon = body.icon
      if (body.model !== undefined) input.model = body.model
      if (body.effort !== undefined) input.effort = body.effort
      if (body.permissionMode !== undefined) input.permissionMode = body.permissionMode
      if (body.background !== undefined) input.background = body.background
      if (body.allowedTools !== undefined) input.allowedTools = body.allowedTools
      if (body.disallowedTools !== undefined) input.disallowedTools = body.disallowedTools
      if (body.enabled !== undefined) input.enabled = body.enabled
      if (body.skillIds !== undefined) input.skillIds = body.skillIds

      const updated = await updateAgent(c.var.db, input, { logger: c.var.logger })
      const skillIds = await listAgentSkillIds(c.var.db, updated.id)
      return c.json(serializeAgentWithSkills(updated, skillIds))
    },
  )
  .post(
    '/:agentId/enable',
    describeRoute({
      tags: ['agents'],
      summary: 'Enable or disable an agent for the session resolver.',
      'x-sdk-name': 'agents.setEnabled',
      responses: {
        200: {
          description: 'The updated agent.',
          content: { 'application/json': { schema: resolver(AgentWithSkillsSchema) } },
        },
        404: { description: 'Agent not found OR owned by another user.' },
      },
    }),
    validator('json', SetAgentEnabledRequestSchema),
    validator('param', AgentIdParamSchema),
    ...userScoped,
    async (c) => {
      const { enabled } = c.req.valid('json')
      const { agentId } = c.req.valid('param')
      const updated = await updateAgent(
        c.var.db,
        { agentId, userId: c.var.user.id, enabled },
        { logger: c.var.logger },
      )
      const skillIds = await listAgentSkillIds(c.var.db, updated.id)
      return c.json(serializeAgentWithSkills(updated, skillIds))
    },
  )
  .delete(
    '/:agentId',
    describeRoute({
      tags: ['agents'],
      summary: 'Soft-delete an agent (retention window before purge).',
      'x-sdk-name': 'agents.delete',
      responses: {
        204: { description: 'Soft-deleted.' },
        404: { description: 'Agent not found OR owned by another user.' },
      },
    }),
    validator('param', AgentIdParamSchema),
    ...userScoped,
    async (c) => {
      const { agentId } = c.req.valid('param')
      await softDeleteAgent(
        c.var.db,
        { agentId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )

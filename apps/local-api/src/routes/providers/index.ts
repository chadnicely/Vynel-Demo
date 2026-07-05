// The `providers` HTTP surface — three read-only routes mounted at
// `/providers` from `apps/local-api/src/app.ts` (source order preserved):
//
//   GET /                    -> listProvidersWithStatus            [x-mcp: list_ai_agent_providers]
//   GET /:providerId/auth    -> getProviderAuthenticationStatus    [x-mcp: get_ai_agent_provider_auth_status]
//   GET /:providerId/skills  -> discoverInstalledSkillsForProvider [x-mcp: discover_installed_skills_for_provider]
//
// Locked Hono protocol per the knowledge/skills precedent: describeRoute
// (from the local openapi.js wrapper — widens the type for x-mcp +
// x-sdk-name) → validator (from hono-openapi/zod) → `...userScoped` →
// handler. Chained methods on `factory.createApp()`. All three GETs opt into
// MCP (safe-by-default reads, mirrored verbatim from source).
//
// The routes reach the runtime through `c.var.aiProvider` (a fake in tests,
// per the skills `/synchronize` precedent) where the source resolved inline;
// the status ops fall back to the registry for any other id, so unregistered
// providerIds keep the source ValidationError → 400 semantics.

import { resolver, validator } from 'hono-openapi/zod'
import {
  discoverInstalledSkillsForProvider,
  getProviderAuthenticationStatus,
  listProvidersWithStatus,
} from '@vynel/providers'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  DiscoverSkillsQuerySchema,
  ProviderIdParamSchema,
  AuthenticationStatusResponseSchema,
  ListProvidersWithStatusResponseSchema,
  DiscoverInstalledSkillsResponseSchema,
} from './schemas.js'

export const providersApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['providers'],
      summary: 'List available AI agent providers with installation + authentication status.',
      'x-sdk-name': 'providers.list',
      responses: {
        200: {
          description: 'One entry per registered provider.',
          content: {
            'application/json': { schema: resolver(ListProvidersWithStatusResponseSchema) },
          },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_ai_agent_providers',
        description:
          'List available AI agent providers (Claude in Phase 1) with installation + ' +
          'authentication status. Returns one entry per provider with ' +
          'isInstalled/isAuthenticated flags + display labels. Read-only.',
      },
    }),
    ...userScoped,
    async (c) => {
      const statuses = await listProvidersWithStatus([c.var.aiProvider])
      return c.json(statuses)
    },
  )
  .get(
    '/:providerId/auth',
    describeRoute({
      tags: ['providers'],
      summary: 'Get install + auth status for one AI agent provider.',
      'x-sdk-name': 'providers.getAuthStatus',
      responses: {
        200: {
          description:
            'The provider status (status-as-data: returns isInstalled false rather than throwing).',
          content: {
            'application/json': { schema: resolver(AuthenticationStatusResponseSchema) },
          },
        },
        400: { description: 'Unsupported providerId.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_ai_agent_provider_auth_status',
        description:
          'Get installation + authentication status for one AI agent provider by id. ' +
          'Returns isInstalled/isAuthenticated/inactiveReason. 400 if providerId is not a ' +
          'recognized provider; never 404 (status-as-data, no enumeration leak). Read-only.',
      },
    }),
    validator('param', ProviderIdParamSchema),
    ...userScoped,
    async (c) => {
      const { providerId } = c.req.valid('param')
      const status = await getProviderAuthenticationStatus(providerId, c.var.aiProvider)
      return c.json(status)
    },
  )
  .get(
    '/:providerId/skills',
    describeRoute({
      tags: ['providers'],
      summary: 'Discover skills installed for one AI agent provider.',
      'x-sdk-name': 'providers.discoverInstalledSkills',
      responses: {
        200: {
          description: 'The skills the runtime sees installed on disk.',
          content: {
            'application/json': { schema: resolver(DiscoverInstalledSkillsResponseSchema) },
          },
        },
        400: { description: 'Unsupported providerId.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'discover_installed_skills_for_provider',
        description:
          'Discover skills installed for one AI agent provider, optionally scoped to a ' +
          'workspace path. Returns the runtime-installed skills as seen on disk ' +
          '(user-scope, workspace-scope, plugin-scope). Read-only.',
      },
    }),
    validator('param', ProviderIdParamSchema),
    validator('query', DiscoverSkillsQuerySchema),
    ...userScoped,
    async (c) => {
      const { providerId } = c.req.valid('param')
      const query = c.req.valid('query')
      const skills = await discoverInstalledSkillsForProvider(
        query.workspacePath !== undefined
          ? { providerId, workspacePath: query.workspacePath }
          : { providerId },
        c.var.aiProvider,
      )
      return c.json(skills)
    },
  )

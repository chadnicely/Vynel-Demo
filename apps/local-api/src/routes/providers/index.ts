// The `providers` HTTP surface — mounted at `/providers` from
// `apps/local-api/src/app.ts` (source order preserved):
//
//   GET /                    -> listProvidersWithStatus            [x-mcp: list_ai_agent_providers]
//   GET /:providerId/auth    -> getProviderAuthenticationStatus    [x-mcp: get_ai_agent_provider_auth_status]
//   POST /:providerId/auth/login                -> begin the LOCAL sign-in (URL out; no x-mcp)
//   POST /:providerId/auth/login/:loginId/code  -> pasted code in, fresh status back (no x-mcp)
//   DELETE /:providerId/auth/login/:loginId     -> cancel a pending sign-in (no x-mcp)
//   GET /:providerId/limits  -> the account's limit windows (no x-mcp)
//   GET /:providerId/models  -> the stored roster (or the curated floor) [x-mcp: list_available_chat_models]
//   POST /:providerId/models/refresh -> re-ask the ENGINE for it (no x-mcp)
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
import { ConflictError, ValidationError } from '@vynel/errors'
import {
  ClaudeLoginRelay,
  discoverInstalledSkillsForProvider,
  getProviderAuthenticationStatus,
  listProvidersWithStatus,
} from '@vynel/providers'
import { findDiscoveredModels, listRateLimitSnapshots } from '@vynel/provider-preferences'
import {
  availableChatModelsFloor,
  toAvailableChatModels,
} from '@vynel/contracts/chat/available-models'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { refreshDiscoveredModels } from '../../sessions/refresh-discovered-models.js'
import { ensureGlobalRootWorkspaceDir } from '../../sessions/global-root-workspace.js'
import {
  DiscoverSkillsQuerySchema,
  ProviderIdParamSchema,
  AuthenticationStatusResponseSchema,
  BeginLoginResponseSchema,
  CancelLoginResponseSchema,
  ListProvidersWithStatusResponseSchema,
  DiscoverInstalledSkillsResponseSchema,
  ListAvailableModelsResponseSchema,
  ListRateLimitSnapshotsResponseSchema,
  LoginSessionParamSchema,
  SubmitLoginCodeRequestSchema,
} from './schemas.js'

// One relay per process — it holds the live `claude auth login` child between
// the "show me the link" and "here is my code" round-trips (the server-install
// route's ClaudeAuthRelay precedent).
const claudeLoginRelay = new ClaudeLoginRelay()

// How long the code round-trip waits for the CLI to write its credential and
// exit before reporting the pending state as a conflict.
const LOGIN_SETTLE_TIMEOUT_MS = 45_000

function requireClaudeProvider(providerId: string): void {
  if (providerId !== 'claude') {
    throw new ValidationError(`Signing in to ${providerId} is not wired up yet — Claude is.`)
  }
}

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
  // ──────────────────────────────────────────────────────────────────
  // The local sign-in (top-bar account popup, 2026-08-18): three hops
  // mirroring the server-install relay — begin (URL out), code (pasted code
  // in, wait for the CLI's own verdict), cancel. NO x-mcp on any: signing the
  // machine in is the USER's door, never an agent tool. The CLI writes its
  // own credential file; no response carries a secret.
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/:providerId/auth/login',
    describeRoute({
      tags: ['providers'],
      summary: 'Begin signing this machine in to the provider (returns the authorization URL).',
      'x-sdk-name': 'providers.beginLogin',
      responses: {
        200: {
          description: 'The sign-in is open: show the URL, then submit the pasted code.',
          content: { 'application/json': { schema: resolver(BeginLoginResponseSchema) } },
        },
        400: { description: 'Unsupported providerId.' },
        409: { description: 'The CLI offered no sign-in link (not installed, no subscription).' },
      },
    }),
    validator('param', ProviderIdParamSchema),
    ...userScoped,
    async (c) => {
      const { providerId } = c.req.valid('param')
      requireClaudeProvider(providerId)
      const state = await claudeLoginRelay.begin()
      // begin() resolves only once the URL is present.
      return c.json({ loginId: state.loginId, authorizationUrl: state.authorizationUrl ?? '' })
    },
  )
  .post(
    '/:providerId/auth/login/:loginId/code',
    describeRoute({
      tags: ['providers'],
      summary: 'Finish the sign-in with the code the browser gave, returning the fresh status.',
      'x-sdk-name': 'providers.submitLoginCode',
      responses: {
        200: {
          description: 'Signed in — the provider status after the CLI wrote its credential.',
          content: { 'application/json': { schema: resolver(AuthenticationStatusResponseSchema) } },
        },
        400: { description: 'Unsupported providerId, or an empty code.' },
        404: { description: 'That sign-in is no longer open — begin again.' },
        409: { description: 'The CLI rejected the code or did not finish.' },
      },
    }),
    validator('param', LoginSessionParamSchema),
    validator('json', SubmitLoginCodeRequestSchema),
    ...userScoped,
    async (c) => {
      const { providerId, loginId } = c.req.valid('param')
      requireClaudeProvider(providerId)
      const { code } = c.req.valid('json')
      claudeLoginRelay.submitCode(loginId, code)
      const settled = await claudeLoginRelay.waitForOutcome(loginId, LOGIN_SETTLE_TIMEOUT_MS)
      if (settled.phase !== 'signed-in') {
        claudeLoginRelay.discard(loginId)
        throw new ConflictError(settled.errorMessage ?? 'The sign-in did not finish. Try again.')
      }
      claudeLoginRelay.discard(loginId)
      const status = await getProviderAuthenticationStatus(providerId, c.var.aiProvider)
      return c.json(status)
    },
  )
  .delete(
    '/:providerId/auth/login/:loginId',
    describeRoute({
      tags: ['providers'],
      summary: 'Cancel a pending sign-in (the dialog was closed).',
      'x-sdk-name': 'providers.cancelLogin',
      responses: {
        200: {
          description: 'The pending sign-in (if any) is discarded — idempotent.',
          content: { 'application/json': { schema: resolver(CancelLoginResponseSchema) } },
        },
        400: { description: 'Unsupported providerId.' },
      },
    }),
    validator('param', LoginSessionParamSchema),
    ...userScoped,
    (c) => {
      const { providerId, loginId } = c.req.valid('param')
      requireClaudeProvider(providerId)
      claudeLoginRelay.discard(loginId)
      return c.json({ ok: true as const })
    },
  )
  .get(
    '/:providerId/limits',
    describeRoute({
      tags: ['providers'],
      summary: "The account's subscription-limit windows, as the engine last reported them.",
      'x-sdk-name': 'providers.listRateLimits',
      responses: {
        200: {
          description:
            'One entry per limit window (five-hour session, seven-day, per-model). ' +
            'Readings ride the session stream, so they refresh whenever a turn runs; ' +
            'empty before the first turn ever reports one.',
          content: {
            'application/json': { schema: resolver(ListRateLimitSnapshotsResponseSchema) },
          },
        },
        400: { description: 'Unsupported providerId.' },
      },
      // No x-mcp: the user's account affordance, mirrored by nothing a tool
      // needs — the model hears about its limits from the engine itself.
    }),
    validator('param', ProviderIdParamSchema),
    ...userScoped,
    (c) => {
      const { providerId } = c.req.valid('param')
      return c.json({ limits: listRateLimitSnapshots(c.var.db, c.var.user.id, providerId) })
    },
  )
  .get(
    '/:providerId/models',
    describeRoute({
      tags: ['providers'],
      summary: 'List the models the provider engine reports it can run.',
      'x-sdk-name': 'providers.listModels',
      responses: {
        200: {
          description:
            'The model roster: discovered from the engine when a turn has run, ' +
            'else the curated static floor. Context windows derived per model.',
          content: {
            'application/json': { schema: resolver(ListAvailableModelsResponseSchema) },
          },
        },
        400: { description: 'Unsupported providerId.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_available_chat_models',
        description:
          'List the chat models the AI engine reports it can run — the legal values for ' +
          'any `model` field. Each entry carries id, label, description, context-window ' +
          'tokens, and supported effort levels. Read-only.',
      },
    }),
    validator('param', ProviderIdParamSchema),
    ...userScoped,
    (c) => {
      const { providerId } = c.req.valid('param')
      const discovered = findDiscoveredModels(c.var.db, c.var.user.id, providerId)
      return c.json({
        models:
          discovered !== null ? toAvailableChatModels(discovered) : availableChatModelsFloor(),
        isDiscovered: discovered !== null,
      })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /:providerId/models/refresh — ask the ENGINE for this account's
  // roster right now (2026-08-17). The roster used to be a side-effect of
  // chatting, so the picker showed the curated floor until a turn had run and
  // never caught up with a mid-session change — which is what made a model
  // appear one moment and be missing the next. Discovery costs no tokens (the
  // engine's startup handshake, no turn) and a failed one changes nothing.
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/:providerId/models/refresh',
    describeRoute({
      tags: ['providers'],
      summary: "Re-ask the engine which models this account can run, then return the roster.",
      'x-sdk-name': 'providers.refreshModels',
      responses: {
        200: {
          description:
            'The roster after the refresh — `isDiscovered` false means the engine could not ' +
            'be asked and the curated floor is what you get.',
          content: {
            'application/json': { schema: resolver(ListAvailableModelsResponseSchema) },
          },
        },
        400: { description: 'Unsupported providerId.' },
      },
      // No x-mcp: the model already reads the roster through
      // `list_available_chat_models`; re-asking the engine is the user's
      // affordance, not a tool.
    }),
    validator('param', ProviderIdParamSchema),
    ...userScoped,
    async (c) => {
      const { providerId } = c.req.valid('param')
      await refreshDiscoveredModels(
        c.var.db,
        c.var.aiProvider,
        {
          userId: c.var.user.id,
          workspacePath: ensureGlobalRootWorkspaceDir(),
        },
        { logger: c.var.logger },
      )
      const discovered = findDiscoveredModels(c.var.db, c.var.user.id, providerId)
      return c.json({
        models:
          discovered !== null ? toAvailableChatModels(discovered) : availableChatModelsFloor(),
        isDiscovered: discovered !== null,
      })
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

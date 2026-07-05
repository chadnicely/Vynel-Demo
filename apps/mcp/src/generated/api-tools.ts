// GENERATED — DO NOT EDIT
//
// Auto-emitted by `scripts/src/generators/generate-mcp-tools.ts` from
// the OpenAPI 3.1 spec at `apps/local-api`'s `/openapi.json`.
// Regenerate via `pnpm api:generate`. Drift is caught by
// `scripts/src/generators/check-mcp-parity.ts` (CI guard).
//
// To add a tool: add `'x-mcp': { exposed: true, name, description }`
// to the route's `describeRoute({...})` in `apps/local-api/src/routes/`,
// then run `pnpm api:generate`. NEVER hand-edit this file.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFactory } from '../mcp-types.js'

// The Claude Agent SDK's `tool()` is overloaded; we widen at the
// call site so the emitter doesn't need to know the exact generic
// shape (per the generator's renderToolEntry pattern).
type McpToolFn = (
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }>,
  options?: {
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      idempotentHint?: boolean
      openWorldHint?: boolean
    }
  },
) => unknown

export const addToKnowledge: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'add_to_knowledge',
    "Add a directory to the knowledge base so its files are indexed for search. `absolutePath` is the directory on disk; `scope` is \"workspace\" (indexed for the active workspace) or \"global\" (indexed for the user across all workspaces). Registers the source, starts watching it for changes, and indexes its current files. Mutating.",
    {
    workspaceId: z.string(),
    absolutePath: z.string(),
    scope: z.enum(['workspace', 'global']),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/sources'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['absolutePath', 'scope']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  )

export const createMemoryEntry: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_memory_entry',
    "Create a new memory entry in the active workspace. Use this to record information the user mentions that should persist across chat sessions — facts about people, preferences, business context, recurring patterns, or general notes. `kind` is one of person / preference / business-fact / recurring-pattern / note. `title` is optional (derived from body if omitted). `body` is the entry content (1-10000 chars). `category` is the high-level grouping the entry belongs to (user / preferences / memory). `section` is a sub-grouping label within that category (e.g. 'Key contacts', 'Communication style'). Side effect: writes a row + publishes a memory.entry-created outbox event. The user's memory panel will show the new entry. Returns the created entry with id + serverside-derived title.",
    {
    workspaceId: z.string(),
    kind: z.enum(['person', 'preference', 'business-fact', 'recurring-pattern', 'note']),
    title: z.string().optional(),
    body: z.string(),
    category: z.enum(['user', 'preferences', 'memory']),
    section: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/entries'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['kind', 'title', 'body', 'category', 'section']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  )

export const discoverInstalledSkillsForProvider: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'discover_installed_skills_for_provider',
    "Discover skills installed for one AI agent provider, optionally scoped to a workspace path. Returns the runtime-installed skills as seen on disk (user-scope, workspace-scope, plugin-scope). Read-only.",
    {
    providerId: z.enum(['claude', 'codex', 'gemini', 'cursor']),
    workspacePath: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/providers/{providerId}/skills'
        pathStr = pathStr.replace('{providerId}', encodeURIComponent(String(args['providerId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['workspacePath']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getAiAgentProviderAuthStatus: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_ai_agent_provider_auth_status',
    "Get installation + authentication status for one AI agent provider by id. Returns isInstalled/isAuthenticated/inactiveReason. 400 if providerId is not a recognized provider; never 404 (status-as-data, no enumeration leak). Read-only.",
    {
    providerId: z.enum(['claude', 'codex', 'gemini', 'cursor']),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/providers/{providerId}/auth'
        pathStr = pathStr.replace('{providerId}', encodeURIComponent(String(args['providerId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getChatSession: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_chat_session',
    "Get one chat session's messages and tool calls by id (owner-scoped — 404 if not in the authenticated user's workspace). Read-only.",
    {
    workspaceId: z.string(),
    sessionId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/chat/sessions/{sessionId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{sessionId}', encodeURIComponent(String(args['sessionId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getCurrentUser: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_current_user',
    "Get the current Vynel user (the single local user in Phase 1). Returns id, display name, email, locale, timezone, and onboarding status.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/users/me'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getIndexerStatus: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_indexer_status',
    "Return the indexer status for the active workspace: total documents, per-parse-state counts (parsed / pending / parsing / failed / skipped), the count of chunks awaiting embedding generation, and the most recent indexed-at timestamp. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/status'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getKnowledgeDocument: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_knowledge_document',
    "Get one knowledge document by id, along with its parsed chunks. Owner-scoped — returns 404 if the document does not belong to the active workspace. The chunks carry character offsets + token estimates; the chunkText is the parsed-and-normalized content used for both FTS and semantic search. Read-only.",
    {
    documentId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/documents/{documentId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{documentId}', encodeURIComponent(String(args['documentId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getUserPreferences: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_user_preferences',
    "Get the current user's resolved preferences (theme, default workspace, chat streaming, reduced motion). Defaults fill any keys the user has not explicitly set.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/users/me/preferences'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const getWorkspace: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_workspace',
    "Get one workspace by id. Owner-scoped — returns 404 if the workspace does not exist OR is not owned by the caller (no enumeration leak). Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listAiAgentProviders: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_ai_agent_providers',
    "List available AI agent providers (Claude in Phase 1) with installation + authentication status. Returns one entry per provider with isInstalled/isAuthenticated flags + display labels. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/providers'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listAllowedSenders: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_allowed_senders',
    "List the external senders allowed to message a connected channel (owner-scoped — 404 if the channel is not in the active workspace). Read-only.",
    {
    channelId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/channels/{channelId}/allowed-senders'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{channelId}', encodeURIComponent(String(args['channelId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listAvailableSkills: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_available_skills',
    "List the Verified-skill catalog the user can install (read-only). Returns each skill's id, display name, one-line description, category, recommended scope, and settings schema. Use this when the user asks what skills exist or which to install. Does NOT modify state.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/skills/available'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listChannels: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_channels',
    "List the connected messaging channels for the active workspace (owner-scoped). Returns each channel WITHOUT its bot credentials. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/channels'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listChatSessions: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_chat_sessions',
    "List chat sessions in a workspace (owner-scoped — returns only the authenticated user's sessions in that workspace; excludes soft-deleted and archived by default). Read-only.",
    {
    workspaceId: z.string(),
    includeArchived: z.boolean().optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/chat/sessions'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['includeArchived', 'limit']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listInstalledSkills: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_installed_skills',
    "List skills installed in the current user+workspace context (owner-scoped). Returns the union of user-scope (available across every workspace) + workspace-scope (this workspace only) entries, each with version, scope, isEnabled flag, install health, and resolved settings. Read-only — use this to know what skills the agent currently has available, not to install them.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/skills/installed'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listKnowledgeDocuments: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_knowledge_documents',
    "List indexed knowledge documents for the active workspace (owner-scoped — only the authenticated user's documents). Supports filtering by documentKind (markdown / plain-text / pdf / docx / html / csv / json), or by an exact `path` (workspace-relative) to fetch the single matching document. Cursor-paginated by (indexedAt DESC NULLS LAST, id DESC). Read-only.",
    {
    workspaceId: z.string(),
    documentKind: z.enum(['markdown', 'plain-text', 'pdf', 'docx', 'html', 'csv', 'json', 'unsupported']).optional(),
    cursorIndexedAt: z.string().nullable().optional(),
    cursorId: z.string().optional(),
    limit: z.number().optional(),
    path: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/documents'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['documentKind', 'cursorIndexedAt', 'cursorId', 'limit', 'path']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listKnowledgeSources: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_knowledge_sources',
    "List the registered knowledge sources in scope for the active workspace: the workspace's own sources plus the user's global sources. Each carries its absolute path, scope, and timestamps. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/sources'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listMemoryEntries: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_memory_entries',
    "List memory entries for the active workspace (owner-scoped — only the authenticated user's entries). Supports filtering by kind (person / preference / business-fact / recurring-pattern / note); cursor-paginated by (lastMentionedAt DESC NULLS LAST, id DESC). Archived entries are excluded unless includeArchived=true. Read-only.",
    {
    workspaceId: z.string(),
    kind: z.enum(['person', 'preference', 'business-fact', 'recurring-pattern', 'note']).optional(),
    includeArchived: z.boolean().optional(),
    cursorLastMentionedAt: z.string().nullable().optional(),
    cursorId: z.string().optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/entries'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['kind', 'includeArchived', 'cursorLastMentionedAt', 'cursorId', 'limit']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listMyChannels: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_my_channels',
    "List every connected messaging channel the user owns — both global (no workspace) and workspace-scoped. Returns each channel WITHOUT its bot credentials. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/channels'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listMySchedules: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_my_schedules',
    "List every scheduled routine the user owns — both global (no workspace) and workspace-scoped. Each has its cron expression (or one-time fire time), destination, enabled flag, and next fire time. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/schedules'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listRoutingChannels: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_routing_channels',
    "List the user's connected messaging channels (id + name + kind) so the global brain can choose which channel to send a message to. Call this first to map a channel the user mentioned to its id. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/channels'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listRoutingWorkspaces: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_routing_workspaces',
    "List the user's workspaces (id + name) so the global brain can choose which workspace to route a task to. Call this first to map a workspace name the user mentioned to its id. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/workspaces'
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listScheduleRuns: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_schedule_runs',
    "List the recent runs of a schedule (owner-scoped, newest first). Each run has its status (completed / failed / missed), timing, and chat session id.",
    {
    scheduleId: z.string(),
    workspaceId: z.string(),
    limit: z.number().optional(),
    cursorStartedAt: z.string().optional(),
    cursorId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules/{scheduleId}/runs'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['limit', 'cursorStartedAt', 'cursorId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listScheduleTemplates: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_schedule_templates',
    "List the built-in schedule templates (morning briefing, weekly summary, email watch, custom).",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules/templates'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listSchedules: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_schedules',
    "List the scheduled routines for the active workspace (owner-scoped). Returns each schedule with its cron expression, destination, enabled flag, and next fire time.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const listWorkspaces: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_workspaces',
    "List the authenticated user's workspaces, most-recently-accessed first. Archived workspaces are excluded unless includeArchived is true. Read-only.",
    {
    includeArchived: z.boolean().optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/workspaces'
        const queryParams = new URLSearchParams()
        for (const k of ['includeArchived', 'limit']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const registerWorkspace: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'register_workspace',
    "Create a new workspace for the user — a project or business area (e.g. 'Bookkeeping', 'Marketing site') the assistant works in, with its own files, chat, and tools. `name` is the display name. `directory` is an EXISTING absolute folder path on disk that becomes the workspace root — confirm the exact path with the user first; the call fails if the folder doesn't exist, isn't a directory, isn't writable, or is already a workspace. `kind` is optional (personal / small-business / project / custom). Creating a workspace is a setup action the user approves. Returns the created workspace.",
    {
    name: z.string(),
    kind: z.enum(['small-business', 'personal', 'project', 'custom']).optional(),
    directory: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/workspaces'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'kind', 'directory']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  )

export const removeKnowledgeSource: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'remove_knowledge_source',
    "Remove a registered knowledge source by id. Stops watching its directory and purges its indexed documents + chunks (cascade). Idempotent — removing an unknown id is a no-op. Mutating.",
    {
    sourceId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/sources/{sourceId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{sourceId}', encodeURIComponent(String(args['sourceId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'DELETE' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  )

export const routeToWorkspace: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'route_to_workspace',
    "Hand a task to a target workspace's own brain (its continuing conversation, with all its context). Use list_routing_workspaces first to pick targetWorkspaceId. This returns IMMEDIATELY with { status: 'enqueued', jobId } — the workspace runs the task in the BACKGROUND and its report arrives a little later as a NEW message in this conversation. Do NOT wait for a result here, and do NOT call this again for the same task — just tell the user you have handed it off. If the task needs an irreversible action (write or edit a file, delete, run a shell command), that action PAUSES for the user to approve — the approval card appears in the app and, for a channel request, in that channel; the task continues once they decide.",
    {
    targetWorkspaceId: z.string(),
    task: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/delegate'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['targetWorkspaceId', 'task']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  )

export const searchChatMessages: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'search_chat_messages',
    "Search chat history in a workspace using full-text search (owner-scoped — only the authenticated user's sessions; excludes soft-deleted). Read-only.",
    {
    workspaceId: z.string(),
    query: z.string(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/chat/sessions/search'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['query', 'limit']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const searchKnowledge: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'search_knowledge',
    "Search the workspace's indexed documents by text query. Mode: \"fts\" (FTS5 keyword), \"semantic\" (sqlite-vec cosine over MiniLM-L6-v2 embeddings), or \"hybrid\" (default; Reciprocal Rank Fusion k=60). Returns up to `limit` matching chunks with FTS snippet (literal <mark> tokens) + scores. Optional documentKindFilter is a comma-separated list of document kinds to restrict to. Owner-scoped. Read-only.",
    {
    workspaceId: z.string(),
    query: z.string(),
    mode: z.enum(['fts', 'semantic', 'hybrid']).optional(),
    limit: z.number().optional(),
    documentKindFilter: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/knowledge/search'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['query', 'mode', 'limit', 'documentKindFilter']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const searchMemory: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'search_memory',
    "Search the workspace's memory entries by text query. Mode: \"fts\" (FTS5 keyword), \"semantic\" (sqlite-vec cosine over MiniLM-L6-v2 embeddings), or \"hybrid\" (default; Reciprocal Rank Fusion k=60). Returns up to `limit` results with title + body snippet (literal <mark> tokens — UI splits, NEVER v-html) + scores. Owner-scoped — only the authenticated user's entries. Read-only.",
    {
    workspaceId: z.string(),
    query: z.string(),
    mode: z.enum(['fts', 'semantic', 'hybrid']).optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/search'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['query', 'mode', 'limit']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'GET' })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )

export const sendToChannel: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'send_to_channel',
    "Send a message to one of the user's connected channels (e.g. their Telegram). Use list_routing_channels first to pick channelId. The message is delivered to the channel's owner. Returns { status: 'sent' }. Use this to proactively notify the user on a channel, or to relay something to a channel they asked about.",
    {
    channelId: z.string(),
    message: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/send-to-channel'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['channelId', 'message']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody })
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Error ${response.status}: ${bodyText}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true } },
  )

// Workspace-scoped tools — the normal chat turn's in-process server.
export const generatedMcpTools: McpToolFactory[] = [
  addToKnowledge,
  createMemoryEntry,
  discoverInstalledSkillsForProvider,
  getAiAgentProviderAuthStatus,
  getChatSession,
  getCurrentUser,
  getIndexerStatus,
  getKnowledgeDocument,
  getUserPreferences,
  getWorkspace,
  listAiAgentProviders,
  listAllowedSenders,
  listAvailableSkills,
  listChannels,
  listChatSessions,
  listInstalledSkills,
  listKnowledgeDocuments,
  listKnowledgeSources,
  listMemoryEntries,
  listMyChannels,
  listMySchedules,
  listScheduleRuns,
  listScheduleTemplates,
  listSchedules,
  listWorkspaces,
  removeKnowledgeSource,
  searchChatMessages,
  searchKnowledge,
  searchMemory,
]

// Routing tools (agent-base Slice 4) — the GLOBAL-ROOT turn's server ONLY.
// Kept OUT of generatedMcpTools so the normal chat turn stays byte-for-byte.
export const generatedRoutingMcpTools: McpToolFactory[] = [
  listRoutingChannels,
  listRoutingWorkspaces,
  registerWorkspace,
  routeToWorkspace,
  sendToChannel,
]

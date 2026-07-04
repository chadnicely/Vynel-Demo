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

// Workspace-scoped tools — the normal chat turn's in-process server.
export const generatedMcpTools: McpToolFactory[] = [
  addToKnowledge,
  getIndexerStatus,
  getKnowledgeDocument,
  listAllowedSenders,
  listAvailableSkills,
  listChannels,
  listInstalledSkills,
  listKnowledgeDocuments,
  listKnowledgeSources,
  listScheduleRuns,
  listScheduleTemplates,
  listSchedules,
  removeKnowledgeSource,
  searchKnowledge,
]

// Routing tools (agent-base Slice 4) — the GLOBAL-ROOT turn's server ONLY.
// Kept OUT of generatedMcpTools so the normal chat turn stays byte-for-byte.
export const generatedRoutingMcpTools: McpToolFactory[] = [

]

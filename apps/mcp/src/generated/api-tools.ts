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

export const addApp: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'add_app',
    "Register a runnable app on the workspace so it can be started, stopped, and monitored. Derive the right `command` by inspecting the workspace first (package.json scripts, monorepo layout) — never guess. `name` is plain language the user recognizes (\"Web app\", \"API server\"). `cwdRelative` is the folder under the workspace root the command runs in (\"\" = root). Set `port` when you know it — it powers the \"open in browser\" link. Add an app once and reuse it; check list_apps before adding.",
    {
    workspaceId: z.string(),
    name: z.string(),
    command: z.string(),
    cwdRelative: z.string().optional(),
    port: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'command', 'cwdRelative', 'port']) {
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

export const addJournalEntry: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'add_journal_entry',
    "Append a dated entry to the daily work journal when meaningful work lands — what happened, what was decided, and anything the next session needs to know, in plain language the user recognizes. `entryDate` is the day it belongs to (YYYY-MM-DD, usually today); `content` is the entry (≤8000 chars). The journal is append-only for you — you cannot edit or remove entries, so write them as a faithful record, not a draft. Do not narrate the bookkeeping. Side effect: the entry appears in the user's journal.",
    {
    workspaceId: z.string(),
    entryDate: z.string(),
    content: z.string(),
    sessionId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/journal'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['entryDate', 'content', 'sessionId']) {
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

export const addMemoryFromFile: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'add_memory_from_file',
    "Read ONE on-disk file (markdown, plain text, PDF, Word, HTML, CSV, or JSON) and save its text as a memory entry in the active workspace. `absolutePath` is the file on disk; `tags` (optional) label it — tag \"context\" to make it part of the standing context every fresh session receives. Files too long for a single memory are rejected with a pointer to the knowledge base (add_to_knowledge), which handles large documents. Mutating.",
    {
    workspaceId: z.string(),
    absolutePath: z.string(),
    tags: z.array(z.string()).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/entries/from-file'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['absolutePath', 'tags']) {
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

export const addToKnowledge: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'add_to_knowledge',
    "Add a directory OR a single file to the knowledge base so it is indexed for search. `absolutePath` is the directory or file on disk; `scope` is \"workspace\" (indexed for the active workspace) or \"global\" (indexed for the user across all workspaces). Registers the source, starts watching it for changes, and indexes it. Mutating.",
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

export const completePlan: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'complete_plan',
    "Mark a plan done when its day's work is finished and verified — typically after its linked tasks are complete. The user sees completed plans as the record of what a day delivered.",
    {
    planId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans/{planId}/complete'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{planId}', encodeURIComponent(String(args['planId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST' })
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

export const completeTask: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'complete_task',
    "Mark a task done the moment its work is finished and verified — not before. The user sees completed tasks on their dashboard as the record of what you've delivered.",
    {
    taskId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/tasks/{taskId}/complete'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{taskId}', encodeURIComponent(String(args['taskId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST' })
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

export const createAgent: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_agent',
    "Create a custom subagent the user can enable for their sessions. `slug` is the stable identifier (kebab-case), `name` the display name, `description` when to use it, `prompt` its system prompt. `scope` is \"user\" (available everywhere) or \"workspace\" (+ `workspaceId`, defaults to the active workspace). Optional: `icon`, `model`, `effort`, `permissionMode`, `background`, `allowedTools` / `disallowedTools`, `skillIds` to preload skills. Use when the user asks for a specialist helper (e.g. a code reviewer, a research agent). The agent must then be enabled (set_agent_enabled) to join sessions. Side effect: it appears in the user's agents panel.",
    {
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    prompt: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    icon: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']).optional(),
    background: z.boolean().optional(),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    skillIds: z.array(z.string()).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/agents'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['slug', 'name', 'description', 'prompt', 'scope', 'workspaceId', 'icon', 'model', 'effort', 'permissionMode', 'background', 'allowedTools', 'disallowedTools', 'skillIds']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
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

export const createGlobalMonitor: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_global_monitor',
    "Arm a watch that wakes THIS conversation when something happens, so you can start something and get on with other work instead of polling. `description` says what you are waiting for in plain language — it is shown to you when the watch fires. `payloadFilter` narrows to one thing ({\"appId\": \"...\"}) using the filterable fields listed below. `mode` is \"once\" (the default — wake me the first time) or \"recurring\" (wake me every time). `expiresInMs` sets the deadline; it defaults to 24 hours and every monitor has one. Returns the monitor id for stopping it. NOTE: the wake starts a NEW turn on this conversation — it will not interrupt one already running.\n\n`eventTypes` must come from this list:\n- `task.completed` — A task on the user’s task list was marked done. Filterable: taskId, workspaceId, planId.\n- `plan.completed` — A dated plan was completed. Filterable: planId, workspaceId, planDate.\n- `app.started` — A workspace app was started and is running. Filterable: appId, workspaceId.\n- `app.stopped` — A workspace app was stopped. Filterable: appId, workspaceId.\n- `app.crashed` — A workspace app exited unexpectedly — watch this to react to a dev server dying. Filterable: appId, workspaceId.\n- `schedule.run-completed` — A scheduled task finished its run. Filterable: scheduleId, workspaceId.\n- `schedule.run-failed` — A scheduled task errored during its run. Filterable: scheduleId, workspaceId.\n- `agent.run-completed` — A configured agent finished a run. Filterable: agentId, workspaceId.\n- `knowledge.document-indexed` — A document finished indexing and is searchable — watch this before searching freshly added sources. Filterable: documentId, workspaceId.\n- `approval.user-resolved` — The user approved or denied an approval card. Filterable: approvalRequestId, workspaceId, resolutionKind.\n- `ask.resolved` — The user answered a question you asked them. Filterable: askId, workspaceId.\n- `channel.connected` — A channel (Telegram, Zoom) finished connecting. Filterable: channelId.\n- `channel.group-discovered` — The bot was added to a group chat and is waiting to be approved. Filterable: channelId, groupId.\n- `workspace.created` — A new workspace was created. Filterable: workspaceId.\n- `monitor.expired` — A monitor reached its deadline. Watch this to learn that a watch you armed died without ever firing (filter firedCount: \"0\"). Filterable: monitorId, workspaceId, firedCount.",
    {
    description: z.string(),
    eventTypes: z.array(z.string()),
    payloadFilter: z.record(z.unknown()).optional(),
    mode: z.enum(['once', 'recurring']).optional(),
    expiresInMs: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/monitors'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['description', 'eventTypes', 'payloadFilter', 'mode', 'expiresInMs']) {
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
    "Create a new memory entry in the active workspace. Use this to record information the user mentions that should persist across chat sessions — facts about people, preferences, business context, recurring patterns, or general notes. `kind` is one of person / preference / business-fact / recurring-pattern / note. `title` is optional (derived from body if omitted). `body` is the entry content (1-10000 chars). `category` is the high-level grouping the entry belongs to (user / preferences / memory). `section` is a sub-grouping label within that category (e.g. 'Key contacts', 'Communication style'). `tags` (optional, up to 8 short labels) organize the entry; the reserved tag \"context\" is special — entries tagged \"context\" are auto-injected at the start of every fresh session as the workspace's standing context, so tag \"context\" exactly the facts a new session must always know (and keep those entries current via update_memory_entry). Side effect: writes a row + publishes a memory.entry-created outbox event. The user's memory panel will show the new entry. Returns the created entry with id + serverside-derived title.",
    {
    workspaceId: z.string(),
    kind: z.enum(['person', 'preference', 'business-fact', 'recurring-pattern', 'note']),
    title: z.string().optional(),
    body: z.string(),
    category: z.enum(['user', 'preferences', 'memory']),
    section: z.string(),
    tags: z.array(z.string()).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/entries'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['kind', 'title', 'body', 'category', 'section', 'tags']) {
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

export const createMonitor: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_monitor',
    "Arm a watch that wakes THIS conversation when something happens, so you can start something and get on with other work instead of polling. `description` says what you are waiting for in plain language — it is shown to you when the watch fires. `payloadFilter` narrows to one thing ({\"appId\": \"...\"}) using the filterable fields listed below. `mode` is \"once\" (the default — wake me the first time) or \"recurring\" (wake me every time). `expiresInMs` sets the deadline; it defaults to 24 hours and every monitor has one. Returns the monitor id for stopping it. NOTE: the wake starts a NEW turn on this conversation — it will not interrupt one already running.\n\n`eventTypes` must come from this list:\n- `task.completed` — A task on the user’s task list was marked done. Filterable: taskId, workspaceId, planId.\n- `plan.completed` — A dated plan was completed. Filterable: planId, workspaceId, planDate.\n- `app.started` — A workspace app was started and is running. Filterable: appId, workspaceId.\n- `app.stopped` — A workspace app was stopped. Filterable: appId, workspaceId.\n- `app.crashed` — A workspace app exited unexpectedly — watch this to react to a dev server dying. Filterable: appId, workspaceId.\n- `schedule.run-completed` — A scheduled task finished its run. Filterable: scheduleId, workspaceId.\n- `schedule.run-failed` — A scheduled task errored during its run. Filterable: scheduleId, workspaceId.\n- `agent.run-completed` — A configured agent finished a run. Filterable: agentId, workspaceId.\n- `knowledge.document-indexed` — A document finished indexing and is searchable — watch this before searching freshly added sources. Filterable: documentId, workspaceId.\n- `approval.user-resolved` — The user approved or denied an approval card. Filterable: approvalRequestId, workspaceId, resolutionKind.\n- `ask.resolved` — The user answered a question you asked them. Filterable: askId, workspaceId.\n- `channel.connected` — A channel (Telegram, Zoom) finished connecting. Filterable: channelId.\n- `channel.group-discovered` — The bot was added to a group chat and is waiting to be approved. Filterable: channelId, groupId.\n- `workspace.created` — A new workspace was created. Filterable: workspaceId.\n- `monitor.expired` — A monitor reached its deadline. Watch this to learn that a watch you armed died without ever firing (filter firedCount: \"0\"). Filterable: monitorId, workspaceId, firedCount.",
    {
    workspaceId: z.string(),
    description: z.string(),
    eventTypes: z.array(z.string()),
    payloadFilter: z.record(z.unknown()).optional(),
    mode: z.enum(['once', 'recurring']).optional(),
    expiresInMs: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/monitors'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['description', 'eventTypes', 'payloadFilter', 'mode', 'expiresInMs']) {
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

export const createPlan: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_plan',
    "Create a plan for a calendar day — use this when the user lays out dated intent (\"tomorrow we tackle the launch\", \"plan Friday for bookkeeping\"). `title` is the short label (≤200 chars); `detail` carries the specifics; `planDate` is the day it belongs to (YYYY-MM-DD, required). Phrase titles in plain language the user recognizes. Break the plan into tasks with create_task, passing this plan's id as `planId`, and move the plan with update_plan / complete_plan as the day's work lands. Side effect: the plan appears in the user's plan list.",
    {
    workspaceId: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    planDate: z.string(),
    sessionId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'detail', 'planDate', 'sessionId']) {
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

export const createSession: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_session',
    "Create a NEW session: a normal continuing conversation with its own context, primed with the purpose you give it. Use it to hand off big or parallel work and keep your own context free — prefer send_task_to_workspace when the task belongs to a specific workspace's ongoing context, and a new session for standalone or cross-cutting work. Check list_sessions first: reuse an existing suitable session instead of creating duplicates. Returns { sessionId, name } — pass sessionId to send_task_to_session. The session appears in the user’s Sessions panel immediately.",
    {
    name: z.string(),
    purpose: z.string(),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/sessions/spawned'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'purpose', 'workspaceId']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
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

export const createTask: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_task',
    "Add a task to the workspace's task list. Use this when the user asks for work with more than one step, or agrees to something you will do later — one task per distinct piece of work, phrased in plain language the user recognizes (e.g. \"Write the spring newsletter draft\"), never technical mechanics. `title` is the short label (≤200 chars); `detail` is optional context; `planId` links the task to a plan (list_plans) when it is part of one. New tasks start as status \"open\"; move them with update_task / complete_task as you work. Do not narrate the bookkeeping — just keep the list current. Side effect: the task appears in the user's task panel and dashboard.",
    {
    workspaceId: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    sessionId: z.string().optional(),
    planId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/tasks'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'detail', 'sessionId', 'planId']) {
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

export const deleteAgent: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_agent',
    "Delete an agent by `agentId`. Soft-delete with a retention window before purge, but treat it as removal — the agent leaves the user's panel and the session resolver immediately. Confirm intent when the user names the agent loosely (slugs are exact).",
    {
    agentId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/agents/{agentId}'
        pathStr = pathStr.replace('{agentId}', encodeURIComponent(String(args['agentId'] ?? '')))
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

export const getAgent: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_agent',
    "Get one agent by `slug` in an exact scope — pass `workspaceId` for a workspace-scoped agent, omit it for user-scope. Returns the full definition including the system prompt and preloaded skill ids. Use before update_agent to see the current shape. Read-only.",
    {
    slug: z.string(),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/agents/{slug}'
        pathStr = pathStr.replace('{slug}', encodeURIComponent(String(args['slug'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['workspaceId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
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

export const getAppLogs: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_app_logs',
    "Read an app's recent output (up to the last 2000 lines, in-memory — empty if it has not run since Vynel started). Use after start_app to confirm health, or to diagnose a crash (the exit line is appended). Optional `tail` limits the line count. Read-only.",
    {
    appId: z.string(),
    workspaceId: z.string(),
    tail: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps/{appId}/logs'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{appId}', encodeURIComponent(String(args['appId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['tail']) {
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

export const getBackgroundRun: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_background_run',
    "Get one handed-off task by its jobId — its status and the FULL text it reported back (list_background_runs shows only a preview). Use it when a run has completed and you need its actual result, or when it failed and you need the error. Read-only.",
    {
    jobId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/routing/background-runs/{jobId}'
        pathStr = pathStr.replace('{jobId}', encodeURIComponent(String(args['jobId'] ?? '')))
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

export const getMarketplaceItem: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_marketplace_item',
    "Get one marketplace item by `itemId` (from list_marketplace_items) with its full description and install state — read it before installing so you can tell the user what the item does. Read-only.",
    {
    itemId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/marketplace/items/{itemId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{itemId}', encodeURIComponent(String(args['itemId'] ?? '')))
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

export const installCuratedAgent: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'install_curated_agent',
    "Install a curated agent from the Vynel catalog (list_curated_agents) so the user can enable it. `slug` picks the catalog entry; `scope` is \"user\" or \"workspace\" (+ `workspaceId`, defaults to the active workspace). Installing is reversible (delete_agent). Side effect: the agent appears in the user's agents panel.",
    {
    slug: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/agents/curated/install'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['slug', 'scope', 'workspaceId']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
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

export const installMarketplaceItem: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'install_marketplace_item',
    "Install a marketplace item (a skill or agent) into this workspace. `itemId` from list_marketplace_items; `scope` \"workspace\" or \"user\" (user-scope = available in every workspace). Cloud artifacts are downloaded and integrity-verified server-side. Reversible via uninstall_marketplace_item. Side effect: the capability becomes available in sessions and appears in the user's panels.",
    {
    workspaceId: z.string(),
    itemId: z.string(),
    scope: z.enum(['user', 'workspace']),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/marketplace/install'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['itemId', 'scope']) {
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

export const listAgents: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_agents',
    "List the user's agents (custom subagents), newest first — user-scope plus the given workspace's when `workspaceId` is set, user-scope only when omitted. Each row has slug, name, description, enabled state, scope, model/effort overrides, and tool allow/deny lists. Check this before creating an agent (the slug may already exist) or when the user asks what helpers they have. Read-only.",
    {
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/agents'
        const queryParams = new URLSearchParams()
        for (const k of ['workspaceId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
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

export const listApps: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_apps',
    "List the workspace's registered runnable apps (dev servers, builds) with live status: running / exited / crashed (with exit code), pid, and the port when known. Check this before adding or starting anything. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps'
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

export const listAvailableChatModels: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_available_chat_models',
    "List the chat models the AI engine reports it can run — the legal values for any `model` field. Each entry carries id, label, description, context-window tokens, and supported effort levels. Read-only.",
    {
    providerId: z.enum(['claude', 'codex', 'gemini', 'cursor']),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/providers/{providerId}/models'
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

export const listBackgroundRuns: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_background_runs',
    "List the tasks you handed off with send_task_to_workspace or send_task_to_session, newest first — each with its jobId, status (queued / running / completed / failed), where it went, and a preview of what it reported back. Use this to check on work you started earlier instead of assuming it finished, and to find the jobId of a run you want the full result for. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/background-runs'
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

export const listCapabilities: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_capabilities',
    "List the active workspace's capabilities (memory, knowledge, tasks, plans, journal, notebook, …) with their enabled state. Check this when a tool you expected is missing (its capability may be off) or the user asks what this workspace can do. Enabling/disabling is done by the user in the app — point them there; there is deliberately no tool for it. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/capabilities'
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

export const listCuratedAgents: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_curated_agents',
    "List the Vynel-curated agent catalog — ready-made specialist agents (slug, name, description, preloaded skills) the user can install without building their own. Browse this when the user wants a capability a stock agent covers, then install with install_curated_agent. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/agents/curated'
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

export const listGlobalMonitors: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_global_monitors',
    "List the watches armed on THIS global conversation — what each is waiting for, whether it is still armed, how many times it has fired, and when it expires. Shows global monitors only; a workspace's own watches are listed by list_monitors there. Check this before arming another so you do not duplicate a watch. Read-only.",
    {
    status: z.enum(['armed', 'fired', 'stopped', 'expired']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/monitors'
        const queryParams = new URLSearchParams()
        for (const k of ['status']) {
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
    "List skills installed in the current user+workspace context (owner-scoped). Returns the union of user-scope (available across every workspace) + workspace-scope (this workspace only) entries, each with version, scope, install health, and resolved settings. Read-only — use this to know what skills the agent currently has available, not to install them.",
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

export const listJournalEntries: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_journal_entries',
    "Read the workspace's daily work journal, newest first. Each entry is a dated moment (`entryDate` YYYY-MM-DD + prose content) recording what happened and what was decided. Read recent entries when picking work back up to understand the flow of the last days. Optional `entryDate` reads one exact day; `from`/`to` (inclusive) read a range; `limit` caps the count (default 100). Read-only.",
    {
    workspaceId: z.string(),
    entryDate: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/journal'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['entryDate', 'from', 'to', 'limit']) {
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

export const listMarketplaceItems: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_marketplace_items',
    "Browse the marketplace for this workspace — skills and agents the user can install, each annotated with its install state. Optional filters: `category`, `publisherTier`, `installState`, `searchQuery`, `sortBy`. Use when the user wants a capability Vynel does not have yet (\"can you do X?\") — find the item, then install_marketplace_item with its id. Read-only.",
    {
    workspaceId: z.string(),
    category: z.enum(['email', 'documents', 'calendar', 'files', 'research', 'notes', 'context', 'creative', 'communication']).optional(),
    publisherTier: z.enum(['verified', 'anthropic-official', 'community']).optional(),
    installState: z.enum(['installed', 'not-installed']).optional(),
    searchQuery: z.string().optional(),
    sortBy: z.enum(['recommended', 'name-asc', 'newest']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/marketplace/items'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['category', 'publisherTier', 'installState', 'searchQuery', 'sortBy']) {
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

export const listMemoryTags: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_memory_tags',
    "List the memory tags in use across the active workspace's entries, merged with the suggested defaults. Use an existing tag when one fits before coining a new one. The reserved tag \"context\" marks entries auto-injected as standing session context. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/tags'
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

export const listMonitors: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_monitors',
    "List the watches armed on this workspace — what each is waiting for, whether it is still armed, how many times it has fired, and when it expires. Check this before arming another one so you do not duplicate a watch, and to find the id to stop. Optional `status` filters to armed / fired / stopped / expired. Read-only.",
    {
    workspaceId: z.string(),
    status: z.enum(['armed', 'fired', 'stopped', 'expired']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/monitors'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['status']) {
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

export const listMyJournalEntries: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_my_journal_entries',
    "Read every journal entry the user owns — both global (no workspace) and workspace-scoped, newest first. Each entry is a dated moment (`entryDate` YYYY-MM-DD + prose content) recording what happened. Optional `entryDate` reads one exact day; `from`/`to` (inclusive) read a range; `limit` caps the count. Read-only.",
    {
    entryDate: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/journal'
        const queryParams = new URLSearchParams()
        for (const k of ['entryDate', 'from', 'to', 'limit']) {
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

export const listMyPlans: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_my_plans',
    "List every plan the user owns — both global (no workspace) and workspace-scoped, newest day first. Each has a title, optional detail, `planDate` (YYYY-MM-DD), status (open / in-progress / done), and who created it. Optional `status` and `planDate` queries narrow the list. Read-only.",
    {
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    planDate: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/plans'
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'planDate']) {
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

export const listMyTasks: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_my_tasks',
    "List every task the user owns — both global (no workspace) and workspace-scoped. Each has a title, optional detail, status (open / in-progress / done), who created it, and an optional planId linking it to a plan. Optional `status` query filters to one status; optional `planId` narrows to one plan's work items. Read-only.",
    {
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    planId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/tasks'
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'planId']) {
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

export const listPlans: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_plans',
    "List the active workspace's plans (owner-scoped), newest day first. A plan is what is planned for a calendar day — title, optional detail, `planDate` (YYYY-MM-DD), status (open / in-progress / done), and who created it. Optional `status` filters to one status; optional `planDate` narrows to one day. A plan's work items are the tasks whose `planId` points at it (list_tasks with `planId`). Check this when the user asks what is planned, or before planning new dated work. Read-only.",
    {
    workspaceId: z.string(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    planDate: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'planDate']) {
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

export const listSessions: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_sessions',
    "List every session — yours (scope 'spawned' = sessions you created), the user's workspaces, and the assistant thread — with per-session context usage: contextTokens used of contextWindow. Check these numbers BEFORE choosing where to send work: a session near its window is a poor target; create a new one instead. Each entry’s sessionId is the handle send_task_to_session accepts. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/sessions/overview'
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

export const listTasks: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_tasks',
    "List the active workspace's task list (owner-scoped). Each task has a title, optional detail, status (open / in-progress / done), who created it (assistant or user), and an optional planId linking it to a plan. Optional `status` query filters to one status; optional `planId` narrows to one plan's work items. Check this at the start of multi-step work to see what is already tracked. Read-only.",
    {
    workspaceId: z.string(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    planId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/tasks'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'planId']) {
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

export const replyToChannel: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'reply_to_channel',
    "Reply to the channel message that started this turn — Telegram DM or group alike. Pass ONLY your answer as `message`; Vynel already knows which channel and which conversation it came from and delivers your reply exactly there (threading onto the asking message in groups). This is THE way a channel gets your answer — plain chat text is never delivered. For proactive outreach on a channel that did NOT ask, use send_to_channel instead.",
    {
    message: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/reply-to-channel'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['message']) {
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

export const reportToRequester: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'report_to_requester',
    "SUPERSEDED by send_message — prefer that one; this still works but will be removed. Report your REAL result up to the conversation that requested this work (your requester). Use it when you finish delegated work, or when a report arrives from a session you delegated to and its outcome should travel further up the chain. Pass the actual findings — data, numbers, file paths — not just \"done\". The requester is resolved automatically from who you are; you cannot choose the destination. Returns IMMEDIATELY with { status: 'enqueued' } — your requester absorbs the report in its own conversation a little later. Only works on background (delegated) turns; if it says there is no requester, simply reply with your findings as text instead.",
    {
    report: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/report'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['report']) {
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

export const sendMessage: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'send_message',
    "Send a message to another session. This is how sessions talk to each other — use it instead of describing what you would like to happen.\n\n`to` is one of:\n- `\"workspace:<workspaceId>\"` — hand a task down to a workspace (ids from list_routing_workspaces).\n- `\"session:<sessionId>\"` — hand a task to a session you created (ids from list_sessions).\n- `\"requester\"` — pass your RESULT back up to whoever asked you for this work. You never name them: who asked is resolved from the turn itself, so it cannot be mis-addressed.\n\n`body` is the task, or the real result — findings, numbers, paths, not just \"done\". Returns IMMEDIATELY with { status: \"enqueued\", jobId }; the other session picks the message up in its own conversation shortly. Track a task you sent with list_background_runs / get_background_run. Reporting only works on a background (delegated) turn — if there is no requester, just reply with your findings as text. For a task you may pick `model` (legal ids from list_available_chat_models) and `thinkingEffort`; omit both for the defaults.",
    {
    to: z.string(),
    body: z.string(),
    model: z.string().optional(),
    thinkingEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/message'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['to', 'body', 'model', 'thinkingEffort']) {
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

export const sendTaskToSession: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'send_task_to_session',
    "SUPERSEDED by send_message — prefer that one; this still works but will be removed. Hand a task to a session you created with create_session (its continuing conversation, with its primed purpose and everything it has done since). Use list_sessions first to pick the sessionId and to CHECK ITS CONTEXT NUMBERS — send to a session with room, or create a new one. This returns IMMEDIATELY with { status: 'enqueued', jobId } — the session runs the task in the BACKGROUND and its report arrives a little later as a NEW message in this conversation. Do NOT wait for a result here, and do NOT call this again for the same task — just tell the user you have handed it off. Tasks sent to the SAME session run one at a time, in order; different sessions run in parallel. If the task needs an irreversible action, that action PAUSES for the user to approve; the task continues once they decide. You may pick the model and thinkingEffort for the task: choose a cheaper model / lower effort for routine tasks, a stronger model / higher effort for hard ones; omit both for the defaults. Legal model ids come from list_available_chat_models.",
    {
    targetSessionId: z.string(),
    task: z.string(),
    workspaceId: z.string().optional(),
    model: z.string().optional(),
    thinkingEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/delegate-session'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['targetSessionId', 'task', 'workspaceId', 'model', 'thinkingEffort']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
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

export const sendTaskToWorkspace: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'send_task_to_workspace',
    "SUPERSEDED by send_message — prefer that one; this still works but will be removed. Hand a task to a target workspace's own brain (its continuing conversation, with all its context). Use list_routing_workspaces first to pick targetWorkspaceId. This returns IMMEDIATELY with { status: 'enqueued', jobId } — the workspace runs the task in the BACKGROUND and its report arrives a little later as a NEW message in this conversation. Do NOT wait for a result here, and do NOT call this again for the same task — just tell the user you have handed it off. If the task needs an irreversible action (write or edit a file, delete, run a shell command), that action PAUSES for the user to approve — the approval card appears in the app and, for a channel request, in that channel; the task continues once they decide. You may pick the model and thinkingEffort for the task: choose a cheaper model / lower effort for routine tasks, a stronger model / higher effort for hard ones; omit both for the defaults. Legal model ids come from list_available_chat_models.",
    {
    targetWorkspaceId: z.string(),
    task: z.string(),
    model: z.string().optional(),
    thinkingEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/delegate'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['targetWorkspaceId', 'task', 'model', 'thinkingEffort']) {
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

export const setAgentEnabled: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'set_agent_enabled',
    "Enable or disable an agent by `agentId` (`enabled` true/false). Only ENABLED agents join sessions as invokable subagents; a freshly created or installed agent starts disabled until the user wants it live. Fully reversible.",
    {
    agentId: z.string(),
    enabled: z.boolean(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/agents/{agentId}/enable'
        pathStr = pathStr.replace('{agentId}', encodeURIComponent(String(args['agentId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['enabled']) {
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

export const speak: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'speak',
    "Speak a short message ALOUD to the user through their voice assistant. Pass plain, spoken-style prose — NO markdown, lists, code, or URLs; write it the way you would say it out loud, and keep it brief (a sentence or two). Use this to answer or notify the user by voice, especially when the request came in by voice. Returns { spoken: true } when it played, or { spoken: false, reason } when the voice assistant is not running (then reply in text instead).",
    {
    text: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/voice/speak'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['text']) {
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

export const startApp: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'start_app',
    "Start a registered app. The user sees it go green in their Apps section. After starting, give it a moment and check get_app_logs to confirm it came up healthy (port conflicts and missing installs show up there).",
    {
    appId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps/{appId}/start'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{appId}', encodeURIComponent(String(args['appId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST' })
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

export const stopApp: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'stop_app',
    "Stop a running app (the whole process tree, so its port frees up). Stopping an app that is not running is a harmless no-op.",
    {
    appId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps/{appId}/stop'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{appId}', encodeURIComponent(String(args['appId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST' })
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

export const stopGlobalMonitor: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'stop_global_monitor',
    "Disarm a watch you armed — use it once you no longer care about the thing you were waiting for, so it does not wake you later. Takes the monitor id from create_monitor / create_global_monitor or either list. Works for global and workspace monitors alike. Only an armed monitor can be stopped.",
    {
    monitorId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/monitors/{monitorId}/stop'
        pathStr = pathStr.replace('{monitorId}', encodeURIComponent(String(args['monitorId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST' })
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

export const stopMonitor: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'stop_monitor',
    "Disarm a watch you armed — use it once you no longer care about the thing you were waiting for, so it does not wake you later. Takes the monitor id from create_monitor or list_monitors. Only an armed monitor can be stopped.",
    {
    monitorId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/monitors/{monitorId}/stop'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{monitorId}', encodeURIComponent(String(args['monitorId'] ?? '')))
        const queryStr = ''
        const requestBody: string | undefined = undefined
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'POST' })
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

export const uninstallMarketplaceItem: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'uninstall_marketplace_item',
    "Uninstall a marketplace item from this workspace by `itemId`. A skill uninstall hard-deletes its files (re-install is possible but any local edits are lost); an agent uninstall is a soft-delete. Confirm intent when the user names the item loosely.",
    {
    workspaceId: z.string(),
    itemId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/marketplace/uninstall'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['itemId']) {
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

export const updateAgent: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_agent',
    "Update an existing agent by `agentId` (get it from list_agents). Any field may be set alone: name, description, prompt, icon, model, effort, permissionMode, background, allowedTools / disallowedTools, skillIds, enabled. Use when the user wants an agent tuned (different prompt, different tools) rather than rebuilt. Edits are reversible by further edits.",
    {
    agentId: z.string(),
    slug: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().optional(),
    icon: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional(),
    permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']).nullable().optional(),
    background: z.boolean().optional(),
    allowedTools: z.array(z.string()).nullable().optional(),
    disallowedTools: z.array(z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
    skillIds: z.array(z.string()).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/agents/{agentId}'
        pathStr = pathStr.replace('{agentId}', encodeURIComponent(String(args['agentId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['slug', 'name', 'description', 'prompt', 'icon', 'model', 'effort', 'permissionMode', 'background', 'allowedTools', 'disallowedTools', 'enabled', 'skillIds']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const updateApp: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_app',
    "Update a registered app's name, command, folder, or port. A running app keeps its current process — the change applies on the next start (stop_app then start_app to restart with the new command).",
    {
    appId: z.string(),
    workspaceId: z.string(),
    name: z.string().optional(),
    command: z.string().optional(),
    cwdRelative: z.string().optional(),
    port: z.number().nullable().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps/{appId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{appId}', encodeURIComponent(String(args['appId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'command', 'cwdRelative', 'port']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const updateMarketplaceItem: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_marketplace_item',
    "Update an installed marketplace skill to the newest catalog version, by `itemId`. Use when the item shows a newer version than the installed one. Downloads and integrity-verifies the new artifact server-side, then replaces the installed SKILL.md. Skills only — agents must be uninstalled and reinstalled instead.",
    {
    workspaceId: z.string(),
    itemId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/marketplace/update'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['itemId']) {
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

export const updateMemoryEntry: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_memory_entry',
    "Update an existing memory entry by id: title, body, kind, isArchived, and/or tags (REPLACE semantics — the list you send becomes the entry's tags). Use this to keep context-tagged entries current instead of creating duplicates: when a standing fact changes, update the entry that holds it. Mutating.",
    {
    entryId: z.string(),
    workspaceId: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
    kind: z.enum(['person', 'preference', 'business-fact', 'recurring-pattern', 'note']).optional(),
    isArchived: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/memory/entries/{entryId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{entryId}', encodeURIComponent(String(args['entryId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'body', 'kind', 'isArchived', 'tags']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const updatePlan: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_plan',
    "Update a plan. Set status \"in-progress\" when its day's work starts, back to \"open\" if it stalls, or \"done\" when everything landed (complete_plan is the shortcut). `planDate` moves the plan to another day when the user reschedules; title/detail edits keep the wording current. Statuses: open / in-progress / done.",
    {
    planId: z.string(),
    workspaceId: z.string(),
    title: z.string().optional(),
    detail: z.string().nullable().optional(),
    planDate: z.string().optional(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans/{planId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{planId}', encodeURIComponent(String(args['planId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'detail', 'planDate', 'status']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const updateTask: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_task',
    "Update a task on the workspace's list. Set status \"in-progress\" when you start working on it, back to \"open\" if you stop, or \"done\" when finished (complete_task is the shortcut for that). Title/detail edits keep the wording current if the work changes shape; `planId` attaches the task to a plan (null detaches). Statuses: open / in-progress / done.",
    {
    taskId: z.string(),
    workspaceId: z.string(),
    title: z.string().optional(),
    detail: z.string().nullable().optional(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    planId: z.string().nullable().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/tasks/{taskId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{taskId}', encodeURIComponent(String(args['taskId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'detail', 'status', 'planId']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: requestBody })
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
  addApp,
  addJournalEntry,
  addMemoryFromFile,
  addToKnowledge,
  completePlan,
  completeTask,
  createAgent,
  createMemoryEntry,
  createMonitor,
  createPlan,
  createTask,
  deleteAgent,
  discoverInstalledSkillsForProvider,
  getAgent,
  getAiAgentProviderAuthStatus,
  getAppLogs,
  getChatSession,
  getCurrentUser,
  getIndexerStatus,
  getKnowledgeDocument,
  getMarketplaceItem,
  getUserPreferences,
  getWorkspace,
  installCuratedAgent,
  installMarketplaceItem,
  listAgents,
  listAiAgentProviders,
  listAllowedSenders,
  listApps,
  listAvailableChatModels,
  listAvailableSkills,
  listCapabilities,
  listChannels,
  listChatSessions,
  listCuratedAgents,
  listInstalledSkills,
  listJournalEntries,
  listKnowledgeDocuments,
  listKnowledgeSources,
  listMarketplaceItems,
  listMemoryEntries,
  listMemoryTags,
  listMonitors,
  listMyChannels,
  listMyJournalEntries,
  listMyPlans,
  listMySchedules,
  listMyTasks,
  listPlans,
  listScheduleRuns,
  listScheduleTemplates,
  listSchedules,
  listTasks,
  listWorkspaces,
  removeKnowledgeSource,
  reportToRequester,
  searchChatMessages,
  searchKnowledge,
  searchMemory,
  sendMessage,
  setAgentEnabled,
  startApp,
  stopApp,
  stopMonitor,
  uninstallMarketplaceItem,
  updateAgent,
  updateApp,
  updateMarketplaceItem,
  updateMemoryEntry,
  updatePlan,
  updateTask,
]

// Routing tools (agent-base Slice 4) — the GLOBAL-ROOT turn's server ONLY.
// Kept OUT of generatedMcpTools so the normal chat turn stays byte-for-byte.
export const generatedRoutingMcpTools: McpToolFactory[] = [
  createGlobalMonitor,
  createSession,
  getBackgroundRun,
  listBackgroundRuns,
  listGlobalMonitors,
  listRoutingChannels,
  listRoutingWorkspaces,
  listSessions,
  registerWorkspace,
  replyToChannel,
  sendMessage,
  sendTaskToSession,
  sendTaskToWorkspace,
  sendToChannel,
  speak,
  stopGlobalMonitor,
]

// Session-library Slice ④b (widened 2026-07-21) — tools ALSO exposed on
// workspace-root turns (x-mcp.workspaceInteractiveSurface): the interactive
// chat stream AND delegated workspace-root runs compose this array; schedule
// fires and spawned-session targets never see it.
export const generatedWorkspaceInteractiveMcpTools: McpToolFactory[] = [
  createSession,
  getBackgroundRun,
  listBackgroundRuns,
  listSessions,
  sendTaskToSession,
]

// The ask-approval tier — DELETE-method routes + x-mcp.askApproval opt-ins.
// Fed into the descriptors' askModeApprovalToolNames: these card ONLY in ask
// mode (auto/bypass run them uncarded). Full tool names under the 'vynel'
// server prefix, matching the descriptor layer's hardcoded server name.
export const generatedAskModeApprovalToolNames: string[] = [
  'mcp__vynel__delete_agent',
  'mcp__vynel__register_workspace',
  'mcp__vynel__remove_knowledge_source',
  'mcp__vynel__uninstall_marketplace_item',
]

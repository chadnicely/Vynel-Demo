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
    "Register a runnable app on the workspace so it can be started, stopped, and monitored. Derive the right `command` by inspecting the workspace first (package.json scripts, monorepo layout) — never guess. `name` is plain language the user recognizes (\"Web app\", \"API server\"). `cwdRelative` is the folder under the workspace root the command runs in (\"\" = root). Set `port` when you know it — it powers the \"open in browser\" link. Set `envFileRelative` to the env file the app loads, relative to its folder (defaults to \".env\") — the user edits that file from the app's Env popup. Add an app once and reuse it; check list_apps before adding.",
    {
    workspaceId: z.string(),
    name: z.string(),
    command: z.string(),
    cwdRelative: z.string().optional(),
    envFileRelative: z.string().optional(),
    port: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'command', 'cwdRelative', 'envFileRelative', 'port']) {
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
    "Append a dated entry to the daily work journal when meaningful work lands — what happened, what was decided, and anything the next session needs to know, in plain language the user recognizes. `entryDate` is the day it belongs to (YYYY-MM-DD, usually today); `content` is the entry (≤8000 chars). When the work landed as a commit, pass `commit` (the short hash) so the entry points at it. Entries are attributed to YOUR session automatically — the user can open the session from the journal to see what was done. The journal is append-only for you — you cannot edit or remove entries, so write them as a faithful record, not a draft. Do not narrate the bookkeeping. Side effect: the entry appears in the user's journal.",
    {
    workspaceId: z.string(),
    entryDate: z.string(),
    content: z.string(),
    sessionId: z.string().optional(),
    commit: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/journal'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['entryDate', 'content', 'sessionId', 'commit']) {
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

export const completeFeature: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'complete_feature',
    "Mark a feature done when it has shipped and been verified. The user sees completed features as the record of what the app can already do.",
    {
    featureId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/features/{featureId}/complete'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{featureId}', encodeURIComponent(String(args['featureId'] ?? '')))
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

export const completePhase: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'complete_phase',
    "Mark a build-plan phase done when its stage has landed and been verified — typically after the features it delivers are complete. The user sees completed phases as the record of how far the build has come.",
    {
    phaseId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/phases/{phaseId}/complete'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{phaseId}', encodeURIComponent(String(args['phaseId'] ?? '')))
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
    "Create a custom subagent the user can enable for their sessions. `slug` is the stable identifier (kebab-case), `name` the display name, `description` when to use it, `prompt` its system prompt. `scope` is \"user\" (available everywhere) or \"workspace\" (+ `workspaceId`, defaults to the active workspace). Optional: `icon`, `model`, `effort`, `permissionMode`, `background`, `allowedTools` / `disallowedTools`, `skillIds` to preload skills. Use when the user asks for a specialist helper (e.g. a code reviewer, a research agent). The agent starts ENABLED and joins sessions at once (set_agent_enabled turns it off). Side effects: it appears in the user's agents panel and is written to <root>/.claude/agents/<slug>.md as a Vynel-managed mirror; a hand-authored file already at that path is refused (409) — use write_agent_file for files the user keeps by hand.",
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

export const createFeature: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_feature',
    "Add a feature to the workspace's catalog — one thing the app should have (\"Online ordering\", \"Loyalty points\"). `title` is the short label (≤200 chars); `description` is the FULL write-up (up to 50k chars): what it does, how it behaves, edge cases, and what \"done\" means. Pass `phaseId` to link it to the build-plan phase that delivers it (list_phases shows the plan) — or leave it off and place it later with update_feature. Side effect: the feature appears in the workspace's catalog.",
    {
    workspaceId: z.string(),
    title: z.string(),
    description: z.string(),
    phaseId: z.string().optional(),
    sessionId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/features'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'description', 'phaseId', 'sessionId']) {
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

export const createGlobalMonitor: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_global_monitor',
    "Arm a watch that wakes THIS conversation when something happens, so you can start something and get on with other work instead of polling. `description` says what you are waiting for in plain language — it is shown to you when the watch fires. `payloadFilter` narrows to one thing ({\"appId\": \"...\"}) using the filterable fields listed below. `mode` is \"once\" (the default — wake me the first time) or \"recurring\" (wake me every time). `expiresInMs` sets the deadline; it defaults to 24 hours and every monitor has one. Returns the monitor id for stopping it. NOTE: the wake starts a NEW turn on this conversation — it will not interrupt one already running.\n\n`eventTypes` must come from this list:\n- `task.completed` — A task on the user’s task list was marked done. Filterable: taskId, workspaceId, planId.\n- `plan.completed` — A dated plan was completed. Filterable: planId, workspaceId, planDate.\n- `app.started` — A workspace app was started and is running. Filterable: appId, workspaceId.\n- `app.stopped` — A workspace app was stopped. Filterable: appId, workspaceId.\n- `app.crashed` — A workspace app exited unexpectedly — watch this to react to a dev server dying. Filterable: appId, workspaceId.\n- `schedule.run-completed` — A scheduled task finished its run. Filterable: scheduleId, workspaceId.\n- `schedule.run-failed` — A scheduled task errored during its run. Filterable: scheduleId, workspaceId.\n- `schedule.run-missed` — A scheduled task’s slot passed while Vynel was not running — the run never happened. Filterable: scheduleId, workspaceId.\n- `agent.run-completed` — A configured agent finished a run. Filterable: agentId, workspaceId.\n- `knowledge.document-indexed` — A document finished indexing and is searchable — watch this before searching freshly added sources. Filterable: documentId, workspaceId.\n- `approval.user-resolved` — The user approved or denied an approval card. Filterable: approvalRequestId, workspaceId, resolutionKind.\n- `ask.resolved` — The user answered a question you asked them. Filterable: askId, workspaceId.\n- `channel.connected` — A channel (Telegram, Zoom) finished connecting. Filterable: channelId.\n- `channel.group-discovered` — The bot was added to a group chat and is waiting to be approved. Filterable: channelId, groupId.\n- `workspace.created` — A new workspace was created. Filterable: workspaceId.\n- `monitor.expired` — A monitor reached its deadline. Watch this to learn that a watch you armed died without ever firing (filter firedCount: \"0\"). Filterable: monitorId, workspaceId, firedCount.\n- `process.completed` — A background process exited cleanly (code 0) — the payload carries the output tail. run_background_process arms this watch for you automatically. Filterable: processId, workspaceId.\n- `process.failed` — A background process failed — a non-zero exit, a kill, a timeout, or a restart; the payload says which and carries the output tail. Filterable: processId, workspaceId.",
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
    "Arm a watch that wakes THIS conversation when something happens, so you can start something and get on with other work instead of polling. `description` says what you are waiting for in plain language — it is shown to you when the watch fires. `payloadFilter` narrows to one thing ({\"appId\": \"...\"}) using the filterable fields listed below. `mode` is \"once\" (the default — wake me the first time) or \"recurring\" (wake me every time). `expiresInMs` sets the deadline; it defaults to 24 hours and every monitor has one. Returns the monitor id for stopping it. NOTE: the wake starts a NEW turn on this conversation — it will not interrupt one already running.\n\n`eventTypes` must come from this list:\n- `task.completed` — A task on the user’s task list was marked done. Filterable: taskId, workspaceId, planId.\n- `plan.completed` — A dated plan was completed. Filterable: planId, workspaceId, planDate.\n- `app.started` — A workspace app was started and is running. Filterable: appId, workspaceId.\n- `app.stopped` — A workspace app was stopped. Filterable: appId, workspaceId.\n- `app.crashed` — A workspace app exited unexpectedly — watch this to react to a dev server dying. Filterable: appId, workspaceId.\n- `schedule.run-completed` — A scheduled task finished its run. Filterable: scheduleId, workspaceId.\n- `schedule.run-failed` — A scheduled task errored during its run. Filterable: scheduleId, workspaceId.\n- `schedule.run-missed` — A scheduled task’s slot passed while Vynel was not running — the run never happened. Filterable: scheduleId, workspaceId.\n- `agent.run-completed` — A configured agent finished a run. Filterable: agentId, workspaceId.\n- `knowledge.document-indexed` — A document finished indexing and is searchable — watch this before searching freshly added sources. Filterable: documentId, workspaceId.\n- `approval.user-resolved` — The user approved or denied an approval card. Filterable: approvalRequestId, workspaceId, resolutionKind.\n- `ask.resolved` — The user answered a question you asked them. Filterable: askId, workspaceId.\n- `channel.connected` — A channel (Telegram, Zoom) finished connecting. Filterable: channelId.\n- `channel.group-discovered` — The bot was added to a group chat and is waiting to be approved. Filterable: channelId, groupId.\n- `workspace.created` — A new workspace was created. Filterable: workspaceId.\n- `monitor.expired` — A monitor reached its deadline. Watch this to learn that a watch you armed died without ever firing (filter firedCount: \"0\"). Filterable: monitorId, workspaceId, firedCount.\n- `process.completed` — A background process exited cleanly (code 0) — the payload carries the output tail. run_background_process arms this watch for you automatically. Filterable: processId, workspaceId.\n- `process.failed` — A background process failed — a non-zero exit, a kill, a timeout, or a restart; the payload says which and carries the output tail. Filterable: processId, workspaceId.",
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

export const createMySchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_my_schedule',
    "Create a scheduled routine for the user — scope 'global' creates a global schedule (no workspace), scope 'workspace' plus that workspace's workspaceId creates one for a named workspace. Use this whenever the user asks to be reminded, or wants something done on a schedule ('remind me…', 'every morning…', 'in 20 minutes…'). Creates a real schedule that fires even after restarts. NEVER simulate a reminder with sleep/timers/background processes. templateKind 'reminder' delivers promptTemplate VERBATIM at fire time (put the user's exact reminder text in it — no AI turn); use 'custom' with a promptTemplate when the fire should DO work (an AI turn runs it). Recurring: set cronExpression (5-field cron, evaluated in `timezone` — defaults to the user's profile timezone). One-time ('at 5pm', 'in 20 minutes'): set fireAt instead (ISO-8601 with offset, must be in the future; it wins over cron).",
    {
    scope: z.enum(['global', 'workspace']),
    templateKind: z.enum(['morning-briefing', 'weekly-summary', 'email-watch', 'custom', 'reminder']),
    displayName: z.string().optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    promptTemplate: z.string().optional(),
    destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
    channelId: z.string().optional(),
    catchUpOnMiss: z.boolean().optional(),
    approvalTimeoutMsOverride: z.number().optional(),
    fireAt: z.string().optional(),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/schedules'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'templateKind', 'displayName', 'cronExpression', 'timezone', 'promptTemplate', 'destinationKind', 'channelId', 'catchUpOnMiss', 'approvalTimeoutMsOverride', 'fireAt', 'workspaceId']) {
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

export const createPhase: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_phase',
    "Add a phase to the workspace's engineering build plan — one stage of \"how the app gets built\" (\"Phase 1 — Foundations\", \"Phase 2 — Ordering flow\"). `title` is the short label (≤200 chars); `description` is the FULL write-up (up to 50k chars): scope, the pieces to build, decisions, and what \"done\" means for the stage. New phases append to the end of the build order. Link the features a phase delivers via create_feature / update_feature with this phase's id. Side effect: the phase joins the workspace's build plan.",
    {
    workspaceId: z.string(),
    title: z.string(),
    description: z.string(),
    sessionId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/phases'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'description', 'sessionId']) {
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
    "Create a plan for a calendar day — use this when the user lays out dated intent (\"tomorrow we tackle the launch\", \"plan Friday for bookkeeping\"), or as the EXECUTION PLAN of a medium/large task (set `taskId` to that task — goal, parts, approach, risks in `detail`, then set_task_steps from it). `title` is the short label (≤200 chars); `detail` carries the specifics; `planDate` is the day it belongs to (YYYY-MM-DD, required). Phrase titles in plain language the user recognizes. For day plans, break the work into tasks with create_task passing this plan's id as `planId`; move the plan with update_plan / complete_plan as the work lands. Side effect: the plan appears in the user's plan list.",
    {
    workspaceId: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    planDate: z.string(),
    sessionId: z.string().optional(),
    taskId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'detail', 'planDate', 'sessionId', 'taskId']) {
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

export const createSchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_schedule',
    "Create a scheduled routine in the active workspace. Use this whenever the user asks to be reminded, or wants something done on a schedule ('remind me…', 'every morning…', 'in 20 minutes…'). Creates a real schedule that fires even after restarts. NEVER simulate a reminder with sleep/timers/background processes. templateKind 'reminder' delivers promptTemplate VERBATIM at fire time (put the user's exact reminder text in it — no AI turn); use 'custom' with a promptTemplate when the fire should DO work (an AI turn runs it). Recurring: set cronExpression (5-field cron, evaluated in `timezone` — defaults to the user's profile timezone). One-time ('at 5pm', 'in 20 minutes'): set fireAt instead (ISO-8601 with offset, must be in the future; it wins over cron).",
    {
    workspaceId: z.string(),
    templateKind: z.enum(['morning-briefing', 'weekly-summary', 'email-watch', 'custom', 'reminder']),
    displayName: z.string().optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    promptTemplate: z.string().optional(),
    destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
    channelId: z.string().optional(),
    catchUpOnMiss: z.boolean().optional(),
    approvalTimeoutMsOverride: z.number().optional(),
    fireAt: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['templateKind', 'displayName', 'cronExpression', 'timezone', 'promptTemplate', 'destinationKind', 'channelId', 'catchUpOnMiss', 'approvalTimeoutMsOverride', 'fireAt']) {
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
    "Create a NEW session: a normal continuing conversation with its own context, primed with the purpose you give it. Use it to hand off big or parallel work and keep your own context free — prefer send_message to \"workspace:<id>\" when the task belongs to a specific workspace's ongoing context, and a new session for standalone or cross-cutting work. Check list_sessions first: reuse an existing suitable session instead of creating duplicates. Give it a clear role name (e.g. \"Email Feature Manager\") and pick the `icon` that matches what it is for — the session wears both everywhere it is listed. Returns { sessionId, name } — address it with send_message to \"session:<sessionId>\". The session appears in the user’s Sessions panel immediately.",
    {
    name: z.string(),
    icon: z.enum(['mail', 'code', 'bug', 'web', 'database', 'docs', 'chart', 'calendar', 'robot', 'build', 'test', 'search', 'chat', 'rocket', 'shield', 'design', 'media', 'book', 'gear', 'users', 'idea', 'folder', 'terminal', 'git', 'lock', 'bell', 'clock', 'package', 'phone', 'money']).optional(),
    purpose: z.string(),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/sessions/spawned'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'icon', 'purpose', 'workspaceId']) {
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

export const createSkill: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'create_skill',
    "Create a NEW skill — a folder Claude Code loads on demand when a task matches its description: <root>/.claude/skills/<skillId>/SKILL.md. `skillId` is kebab-case (e.g. \"weekly-report\"); `scope` is \"user\" (~/.claude/skills — available in every workspace) or \"workspace\" (<workspace>/.claude/skills; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). `description` is the one line that tells Claude WHEN to use the skill (be specific — it is the trigger); `body` is the SKILL.md instructions in markdown. Add supporting files (references, templates, scripts) afterwards with write_skill_file. Refuses a name already installed or already on disk. Only create a skill when the user asked for one. Mutating.",
    {
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    skillId: z.string(),
    description: z.string(),
    body: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/skills'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'workspaceId', 'skillId', 'description', 'body']) {
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

export const deleteAgentFile: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_agent_file',
    "Delete ONE hand-authored subagent file by `slug` (`scope` \"user\" or \"workspace\" + `workspaceId`, defaults to the active workspace). Removes the file from disk so the subagent stops existing. A Vynel agent is deleted with delete_agent instead. Irreversible; confirm with the user unless they just asked for exactly this.",
    {
    slug: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/agents/files/{slug}'
        pathStr = pathStr.replace('{slug}', encodeURIComponent(String(args['slug'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
        }
        const queryStr = queryParams.toString()
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

export const deleteCommand: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_command',
    "Delete ONE slash command by `commandName`. `scope` is \"user\" (~/.claude/commands — runnable in every workspace) or \"workspace\" (<workspace>/.claude/commands; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). Removes the file from disk so \"/<commandName>\" stops working. Irreversible; confirm with the user unless they just asked for exactly this.",
    {
    commandName: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/commands/{commandName}'
        pathStr = pathStr.replace('{commandName}', encodeURIComponent(String(args['commandName'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
        }
        const queryStr = queryParams.toString()
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

export const deleteFeature: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_feature',
    "Remove a feature from the catalog — only when the user decides the app should NOT have it (prefer update_feature for rewrites and re-linking). This permanently deletes the feature's write-up.",
    {
    featureId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/features/{featureId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{featureId}', encodeURIComponent(String(args['featureId'] ?? '')))
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

export const deletePhase: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_phase',
    "Remove a phase from the build plan — only when the user reshapes the plan and a stage genuinely goes away (prefer update_phase for renames and reordering). Features linked to it stay; unlink or relink them with update_feature. This permanently deletes the phase's write-up.",
    {
    phaseId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/phases/{phaseId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{phaseId}', encodeURIComponent(String(args['phaseId'] ?? '')))
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

export const deleteRule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_rule',
    "Delete ONE rule file by `ruleId`. `scope` is \"user\" (~/.claude/rules — applies in every workspace) or \"workspace\" (<workspace>/.claude/rules; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). Removes the file from disk — the user's own or a Marketplace install alike — so the rule stops applying to future sessions. Irreversible; confirm with the user unless they just asked for exactly this.",
    {
    ruleId: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/rules/{ruleId}'
        pathStr = pathStr.replace('{ruleId}', encodeURIComponent(String(args['ruleId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
        }
        const queryStr = queryParams.toString()
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

export const deleteSkillFile: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'delete_skill_file',
    "Delete ONE supporting file from an installed skill by `skillId` and `relativePath`. `scope` is \"user\" (~/.claude/skills — available in every workspace) or \"workspace\" (<workspace>/.claude/skills; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). SKILL.md cannot be deleted this way — that is uninstall_skill. Irreversible.",
    {
    skillId: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    relativePath: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/skills/{skillId}/files'
        pathStr = pathStr.replace('{skillId}', encodeURIComponent(String(args['skillId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId', 'relativePath']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
        }
        const queryStr = queryParams.toString()
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

export const disableMySchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'disable_my_schedule',
    "Turn any schedule the user owns (global or workspace) off — it stays listed but stops firing until re-enabled. Use this to pause a routine, never to delete it.",
    {
    scheduleId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/schedules/{scheduleId}/disable'
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
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

export const disableSchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'disable_schedule',
    "Turn a schedule in the active workspace off — it stays listed but stops firing until re-enabled. Use this to pause a routine, never to delete it.",
    {
    scheduleId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules/{scheduleId}/disable'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
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

export const displayAddWidget: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'display_add_widget',
    "The Display is a glanceable board beside the conversation. Use it when the answer is a report, a table, numbers, or anything the user will keep looking at after this turn — especially on voice, where the reply is heard and not read. NEVER instead of answering: say the takeaway in your reply too. Call display_list_widgets first and prefer display_update_widget on a matching card over adding a near-duplicate. scope is 'global' in the global conversation, or this workspace's id in a workspace conversation (whoami reports it). content is one of four kinds: {kind:'markdown', body} · {kind:'table', columns:[string], rows:[[string]], caption?} (≤12 columns, ≤200 rows, every row exactly as long as columns) · {kind:'metric', value, label, delta?, tone?:'default'|'attention'|'live'|'muted'} · {kind:'chart', type:'bar'|'line'|'donut', series:[{name, points:[{label, value}]}]} (≤4 series, ≤60 points each). Serialized content is capped at 32 KB. slot is 'left' | 'stage' | 'right' | 'dock' (default 'stage', the widest region; 'dock' is the mini Display floating over the user's screen while they work — send a single number or one line there, never a table or a chart) and size is 'sm' | 'md' | 'lg' (default 'md'). expiresAt is optional (ISO-8601, and in the future) — for a card that should clean itself up, e.g. a 'today' panel. Leave it out for a card that stays until someone removes it. The board holds 12 per scope: a 13th quietly evicts the oldest, so this never fails for being full.",
    {
    scope: z.string(),
    title: z.string(),
    content: z.discriminatedUnion('kind', [
      z.object({
        kind: z.enum(['markdown']),
        body: z.string(),
      }),
      z.object({
        kind: z.enum(['table']),
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        caption: z.string().optional(),
      }),
      z.object({
        kind: z.enum(['metric']),
        value: z.string(),
        label: z.string(),
        delta: z.string().optional(),
        tone: z.enum(['default', 'attention', 'live', 'muted']).optional(),
      }),
      z.object({
        kind: z.enum(['chart']),
        type: z.enum(['bar', 'line', 'donut']),
        series: z.array(z.object({
          name: z.string(),
          points: z.array(z.object({
            label: z.string(),
            value: z.number(),
          })),
        })),
      }),
    ]),
    slot: z.enum(['left', 'stage', 'right', 'dock']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    expiresAt: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/display/widgets'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'title', 'content', 'slot', 'size', 'expiresAt']) {
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

export const displayClear: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'display_clear',
    "Clear a whole Display board at once — the user said \"clear the display\", or the subject changed entirely. scope is 'global' in the global conversation, or this workspace's id in a workspace conversation (whoami reports it). To take a single card off, use display_remove_widget instead. This only clears cards off a screen; nothing they described is deleted.",
    {
    scope: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/display/clear'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope']) {
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

export const displayListWidgets: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'display_list_widgets',
    "The Display is a glanceable board beside the conversation. Use it when the answer is a report, a table, numbers, or anything the user will keep looking at after this turn — especially on voice, where the reply is heard and not read. NEVER instead of answering: say the takeaway in your reply too. This lists what is ALREADY on the board — call it before adding, and update the matching widget rather than adding a near-duplicate. scope is 'global' in the global conversation, or this workspace's id in a workspace conversation (whoami reports it). Read-only.",
    {
    scope: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/display/widgets'
        const queryParams = new URLSearchParams()
        for (const k of ['scope']) {
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

export const displayRemoveWidget: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'display_remove_widget',
    "Take one widget off the Display — the user said \"remove it\", or the thing it showed is finished. Find widgetId via display_list_widgets. This only clears a card off a screen; nothing the widget described is deleted.",
    {
    widgetId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/display/widgets/{widgetId}/remove'
        pathStr = pathStr.replace('{widgetId}', encodeURIComponent(String(args['widgetId'] ?? '')))
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

export const displayUpdateWidget: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'display_update_widget',
    "The Display is a glanceable board beside the conversation. Use it when the answer is a report, a table, numbers, or anything the user will keep looking at after this turn — especially on voice, where the reply is heard and not read. NEVER instead of answering: say the takeaway in your reply too. Update the card already showing this thing instead of adding another one — a live number, a table gaining rows, a status changing. Find widgetId via display_list_widgets. Only the fields you pass change. content is one of four kinds: {kind:'markdown', body} · {kind:'table', columns:[string], rows:[[string]], caption?} (≤12 columns, ≤200 rows, every row exactly as long as columns) · {kind:'metric', value, label, delta?, tone?:'default'|'attention'|'live'|'muted'} · {kind:'chart', type:'bar'|'line'|'donut', series:[{name, points:[{label, value}]}]} (≤4 series, ≤60 points each). Serialized content is capped at 32 KB. expiresAt is optional (ISO-8601, and in the future) — for a card that should clean itself up, e.g. a 'today' panel. Leave it out for a card that stays until someone removes it. A widget cannot move between boards; to put it elsewhere, remove it and add it there.",
    {
    widgetId: z.string(),
    title: z.string().optional(),
    content: z.discriminatedUnion('kind', [
      z.object({
        kind: z.enum(['markdown']),
        body: z.string(),
      }),
      z.object({
        kind: z.enum(['table']),
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        caption: z.string().optional(),
      }),
      z.object({
        kind: z.enum(['metric']),
        value: z.string(),
        label: z.string(),
        delta: z.string().optional(),
        tone: z.enum(['default', 'attention', 'live', 'muted']).optional(),
      }),
      z.object({
        kind: z.enum(['chart']),
        type: z.enum(['bar', 'line', 'donut']),
        series: z.array(z.object({
          name: z.string(),
          points: z.array(z.object({
            label: z.string(),
            value: z.number(),
          })),
        })),
      }),
    ]).optional(),
    slot: z.enum(['left', 'stage', 'right', 'dock']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    expiresAt: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/display/widgets/{widgetId}'
        pathStr = pathStr.replace('{widgetId}', encodeURIComponent(String(args['widgetId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'content', 'slot', 'size', 'expiresAt']) {
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

export const enableMySchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'enable_my_schedule',
    "Turn any schedule the user owns (global or workspace) back on so it fires again at its next scheduled time.",
    {
    scheduleId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/schedules/{scheduleId}/enable'
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
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

export const enableSchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'enable_schedule',
    "Turn a schedule in the active workspace back on so it fires again at its next scheduled time.",
    {
    scheduleId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules/{scheduleId}/enable'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
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

export const endCall: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'end_call',
    "Leave a live call: detaches Vynel's ears and voice from the call audio and stops the call conversation. The call's session remains — after ending, collect the outcome for the user: send one message to \"session:<sessionId>\" asking for a summary of decisions, open questions, and action items (or read it with get_chat_session), then relay that to the user. Returns { ended, sessionId } on success, or { ended: false, reason } when the call was already gone.",
    {
    callId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/voice/calls/{callId}'
        pathStr = pathStr.replace('{callId}', encodeURIComponent(String(args['callId'] ?? '')))
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

export const getBackgroundProcess: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_background_process',
    "Get one background process by its processId — status, exit code, and the output tail (live while it runs, final once it settled). Use it when you were woken with a result and need more of the output, or to check on a run mid-flight. Read-only.",
    {
    processId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/processes/{processId}'
        pathStr = pathStr.replace('{processId}', encodeURIComponent(String(args['processId'] ?? '')))
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
    "Read one session’s full conversation (messages + tool calls) by sessionId — works for any of the user’s sessions across workspaces, including spawned and agent sessions (the global assistant thread is readable only by the global assistant itself — its own earlier segments). Get sessionIds from list_sessions or search_chat_messages. Transcripts can be long — prefer search_chat_messages when you only need to find something. Read-only.",
    {
    sessionId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/sessions/{sessionId}/messages'
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

export const getDelegatedTask: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_delegated_task',
    "Get one handed-off task by its jobId — its status and the FULL text it reported back (list_delegated_tasks shows only a preview). Use it when a task has completed and you need its actual result, or when it failed and you need the error. Read-only.",
    {
    jobId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/routing/delegated-tasks/{jobId}'
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

export const getFeature: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_feature',
    "Read one feature with its FULL description — the complete write-up of what it does and how it behaves (list_features only carries previews). Use this before building or changing the feature so the full spec grounds the work. Read-only.",
    {
    featureId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/features/{featureId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{featureId}', encodeURIComponent(String(args['featureId'] ?? '')))
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

export const getPhase: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_phase',
    "Read one build-plan phase with its FULL description — the complete write-up of the stage (list_phases only carries previews). Use this before working on a phase so the full plan text grounds the work. Read-only.",
    {
    phaseId: z.string(),
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/phases/{phaseId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{phaseId}', encodeURIComponent(String(args['phaseId'] ?? '')))
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

export const getSkill: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_skill',
    "Read an installed skill by `skillId`. `scope` is \"user\" (~/.claude/skills — available in every workspace) or \"workspace\" (<workspace>/.claude/skills; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). Returns every file in the skill folder (relativePath, size, whether it is text) and the content of ONE text file — SKILL.md unless `relativePath` names another. Use it to see what a skill does before editing it, or to open a supporting file. Read-only.",
    {
    skillId: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    relativePath: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/skills/{skillId}/files'
        pathStr = pathStr.replace('{skillId}', encodeURIComponent(String(args['skillId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId', 'relativePath']) {
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

export const getUserPreferences: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_user_preferences',
    "Get the current user's resolved preferences (theme, default workspace, chat streaming, reduced motion, the voice: TTS model, speaker, STT model, and whether Vynel may act on the desktop). Defaults fill any keys the user has not explicitly set.",
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

export const getWorkspaceBrief: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_workspace_brief',
    "Read this workspace's brief — what the user agreed to when they set it up with the new-workspace wizard: the answers they gave (the idea, who it is for, what it keeps track of, the wish list with where each item came from, the stack), the plan they approved (the one-liner, what to build, the MVP in a nutshell, the goals, and the build sessions IN ORDER with `mvp: false` marking what comes after the MVP), and the brief text they sent as the first message. `brief` is null when the workspace was not made by the wizard (pulled in from a folder or a repository). Read it before planning or resuming the build so the work stays the plan the user approved. Read-only.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/brief'
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

export const getWorkspaceGitFacts: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'get_workspace_git_facts',
    "Read what git knows about this workspace's folder, fresh: `facts.kind` is 'repository' (with the current branch, its upstream and how many commits ahead/behind, the count of changed and untracked files, and the origin address), 'not-a-repository' (a plain folder — no git yet), 'folder-missing', 'no-git' (git is not installed), or 'unreadable' (git's own reason). `branches` lists the local branches with the checked-out one marked; `worktrees` lists every checkout of the repository, the main one first, then every linked worktree (the sessions' `.claude/worktrees/<slug>` folders among them). Use it before deciding where to work or whether there is uncommitted work to protect. Read-only — it never changes the repository.",
    {
    workspaceId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/git'
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
    "Install a marketplace item (a skill, agent, plugin, MCP server, or rule) into this workspace. `itemId` from list_marketplace_items; `scope` \"workspace\" or \"user\" (user-scope = available in every workspace). Cloud artifacts are downloaded and integrity-verified server-side; plugins install through Claude Code's own plugin system; MCP servers are written into the scope's Claude config. An MCP item that requires configuration (API keys, tokens) cannot be installed from here — direct the user to the Marketplace panel, which collects those values; secrets must never be pasted into chat. Reversible via uninstall_marketplace_item. Side effect: the capability becomes available in sessions and appears in the user's panels.",
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

export const killBackgroundProcess: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'kill_background_process',
    "End a running background process early — use it when you no longer need the result. Takes the processId from run_background_process or list_background_processes; the completion watch still fires, reporting it killed.",
    {
    processId: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/processes/{processId}/kill'
        pathStr = pathStr.replace('{processId}', encodeURIComponent(String(args['processId'] ?? '')))
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

export const listAgentFiles: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_agent_files',
    "List the subagent files the user wrote by hand — every `.claude/agents/*.md` in ~/.claude/agents (scope \"user\") plus the workspace's own when `workspaceId` is set (defaults to the active workspace; omit on the global surface). These are NOT the agents list_agents returns (those live in Vynel); they are plain Claude Code subagent files, live in every session. Each row: slug (the file name), name, description, tools, model, the full file content and the prompt body. Read-only.",
    {
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/agents/files'
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

export const listAgents: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_agents',
    "List the user's agents (custom subagents), newest first — user-scope plus the given workspace's when `workspaceId` is set, user-scope only when omitted. Each row has slug, name, description, enabled state, scope, model/effort overrides, and tool allow/deny lists. Check this before creating an agent (the slug may already exist) or when the user asks what helpers they have. Read-only.",
    {
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/agents/resolved'
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

export const listBackgroundProcesses: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_background_processes',
    "List the background processes of this scope, newest first — each with its processId, status (running / succeeded / failed), exit code, and output tail. Check this instead of assuming a command finished. Optional `status` filters. Read-only.",
    {
    status: z.enum(['running', 'succeeded', 'failed']).optional(),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/processes'
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'workspaceId']) {
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

export const listCalls: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_calls',
    "List the live calls Vynel is currently on — each with its callId, label, mode (notetaker/participant), sessionId, and when it started. Empty when not in any call. Read-only; use it before start_call (one call at a time in this version) or to find the callId for speak/end_call.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/voice/calls'
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

export const listCommands: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_commands',
    "List the user's slash commands — every command file in ~/.claude/commands (scope \"user\", runnable in every workspace) plus the workspace's own .claude/commands when `workspaceId` is set (defaults to the active workspace; omit on the global surface). Each row: commandName (what the user types after \"/\", e.g. \"git:commit\"), description, argumentHint, the full file content, and scope. A command is a reusable prompt the user runs by name; use this to see what exists before writing one, or when the user asks what commands they have. Read-only.",
    {
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/commands/resolved'
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

export const listDelegatedTasks: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_delegated_tasks',
    "List the tasks you handed off with send_message, newest first — each with its jobId, status (queued / running / completed / failed), where it went, and a preview of what it reported back. Use this to check on work you started earlier instead of assuming it finished, and to find the jobId of a task you want the full result for. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/delegated-tasks'
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

export const listFeatures: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_features',
    "List the workspace's features — the catalog of what the app should have. Each feature carries a title, a big-form description (TRUNCATED to a preview here — call get_feature for the full write-up), status (open / in-progress / done), and an optional `phaseId` linking it to the build-plan phase that delivers it. Optional `status` filters to one status; optional `phaseId` narrows to one phase's features. Check this before designing or building functionality. Read-only.",
    {
    workspaceId: z.string(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    phaseId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/features'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'phaseId']) {
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
        let pathStr = '/workspaces/{workspaceId}/skills/installed/resolved'
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
    "Browse the marketplace for this workspace — skills, agents, plugins, MCP servers, and rules the user can install, each annotated with its install state. Optional filters: `category`, `publisherTier`, `installState`, `searchQuery`, `sortBy`. Use when the user wants a capability Vynel does not have yet (\"can you do X?\") — find the item, then install_marketplace_item with its id. Read-only.",
    {
    workspaceId: z.string(),
    category: z.string().optional(),
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
    taskId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/plans'
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'planDate', 'taskId']) {
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

export const listPhases: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_phases',
    "List the workspace's engineering build plan — its phases in build order. A phase is one stage of how the app gets built: title, a big-form description (TRUNCATED to a preview here — call get_phase for the full write-up), 0-based `orderIndex`, and status (open / in-progress / done). Optional `status` filters to one status. Check this before planning or building anything, and keep statuses moving as stages land. Read-only.",
    {
    workspaceId: z.string(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/phases'
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

export const listPlans: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_plans',
    "List the active workspace's plans (owner-scoped), newest day first. A plan is what is planned for a calendar day — title, optional detail, `planDate` (YYYY-MM-DD), status (open / in-progress / done), and who created it. Optional `status` filters to one status; optional `planDate` narrows to one day; optional `taskId` finds the plan executing one task. A plan's work items are the tasks whose `planId` points at it (list_tasks with `planId`). Check this when the user asks what is planned, or before planning new dated work. Read-only.",
    {
    workspaceId: z.string(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    planDate: z.string().optional(),
    taskId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['status', 'planDate', 'taskId']) {
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

export const listRules: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_rules',
    "List the standing rules Claude follows — every rule file in the user's ~/.claude/rules (scope \"user\", applies in every workspace) plus the workspace's own .claude/rules when `workspaceId` is set (defaults to the active workspace; omit on the global surface). Each row: ruleId (the file name), title, the full markdown content, scope, and marketplace provenance (non-null = installed from the Marketplace and still managed by it). These files already load into your context — use this to see, quote, or check a rule before writing or deleting one. Read-only.",
    {
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/rules/resolved'
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
    "List every session — yours (scope 'spawned' = sessions you created), the user's workspaces, and the assistant thread — with per-session context usage: contextTokens used of contextWindow. Check these numbers BEFORE choosing where to send work: a session near its window is a poor target; create a new one instead. Each entry’s sessionId is what send_message’s \"session:<sessionId>\" destination accepts. Read-only.",
    {
    scope: z.enum(['workspace', 'global']).optional(),
    workspaceId: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/sessions/overview'
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId', 'limit', 'offset']) {
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

export const listWorkspaceGroups: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'list_workspace_groups',
    "List the authenticated user's workspace folders — the groups that organize workspaces in the navigation tree. Membership is each workspace's groupId. Read-only.",
    {},
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/workspaces/groups'
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
    "Create a new workspace for the user — a project or business area (e.g. 'Bookkeeping', 'Marketing site') the assistant works in, with its own files, chat, and tools. `name` is the display name. `directory` is an EXISTING absolute folder path on disk that becomes the workspace root — confirm the exact path with the user first; the call fails if the folder doesn't exist, isn't a directory, isn't writable, or is already a workspace. `kind` is optional (personal / small-business / project / custom); `groupId` optionally files it into one of the user's workspace groups. Creating a workspace is a setup action the user approves. Returns the created workspace.",
    {
    name: z.string(),
    kind: z.enum(['small-business', 'personal', 'project', 'custom']).optional(),
    directory: z.string(),
    groupId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/workspaces'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'kind', 'directory', 'groupId']) {
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

export const runBackgroundProcess: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'run_background_process',
    "Run a shell command in the BACKGROUND — it keeps running after this turn ends, and when it exits you are WOKEN with the exit code and the output tail (a completion watch is armed for you automatically). Use it for long work you should not sit through: test suites, builds, installs. The command runs at your scope’s folder (the workspace’s folder, or the global ground). `timeoutMs` is the runtime ceiling — the process is killed past it (default 30 minutes, max 24 hours). Returns IMMEDIATELY with { processId, status: \"running\" }; check on it with list_background_processes / get_background_process, end it early with kill_background_process. NOT for quick commands (use Bash — you get the answer in the same turn) and NOT for work another session should own (send_message a task).",
    {
    command: z.string(),
    timeoutMs: z.number().optional(),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/processes'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['command', 'timeoutMs', 'workspaceId']) {
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

export const searchChatMessages: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'search_chat_messages',
    "Full-text search across ALL of the user’s session conversations — workspace chats and spawned/agent sessions alike (the global assistant thread is included only for the global assistant itself — its own earlier context). Pass workspaceId to restrict to one workspace; omit it to search the entire system. Returns message-level hits with <mark> snippets and each hit’s sessionId — pass that to get_chat_session to read the full conversation. Read-only.",
    {
    query: z.string(),
    workspaceId: z.string().optional(),
    limit: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/sessions/search'
        const queryParams = new URLSearchParams()
        for (const k of ['query', 'workspaceId', 'limit']) {
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
    "Send a message to another session. This is how sessions talk to each other — use it instead of describing what you would like to happen.\n\n`to` is one of:\n- `\"workspace:<workspaceId>\"` — hand a task down to a workspace (ids from list_routing_workspaces).\n- `\"session:<sessionId>\"` — hand a task to one of YOUR OWN sessions or agent colleagues (ids from list_sessions). A task only reaches sessions you created: for another workspace's session, send the task to that workspace instead and let its manager route it.\n- `\"global\"` — a NOTE to the global assistant conversation (kind \"note\" only — the global assistant takes no tasks): hand it a thought, a heads-up, or something the user said elsewhere.\n- `\"requester\"` — speak back up to whoever asked you for this work. You never name them: who asked is resolved from the turn itself, so it cannot be mis-addressed.\n\nFor a workspace/session target, `kind` \"note\" sends plain COMMUNICATION instead of work — coordination like \"when you finish, tell the planner session\" or \"I am editing that file, leave it alone\". A note may address ANY of your workspaces or sessions (no own-session restriction), creates no task, expects no report, and is not tracked; the receiver absorbs it and replies with a note only if yours asks for one. Never use a note to hand out work.\n\nFor \"requester\", `kind` picks the voice: `\"update\"` = an interim acknowledgment or progress line (\"Received — starting now\"; the task stays running), `\"report\"` = the FINAL result addressed to whoever sent you the work — findings, numbers, paths, not just \"done\" (default; marks the task finished), `\"direct_to_user\"` = the FINAL result addressed to the USER themselves: it appears in their conversation as YOUR message, verbatim and never summarized, under a short `title` you must provide (the headline on the message box). Prefer \"direct_to_user\" whenever the user should read the answer itself — an overview, findings, a document, anything they asked to see — and \"report\" when the requester will act on it. Send exactly one final report/direct_to_user per task.\n\nReturns IMMEDIATELY with { status: \"enqueued\", jobId }; the other session picks the message up in its own conversation shortly. Track a task you sent with list_delegated_tasks / get_delegated_task. Speaking upward only works on a background (delegated) turn — if there is no requester, just reply with your findings as text. For a TASK you may pick `model` (legal ids from list_available_chat_models) and `thinkingEffort`; omit both for the defaults — they are rejected on any other kind.",
    {
    to: z.string(),
    body: z.string(),
    kind: z.enum(['task', 'note', 'report', 'update', 'direct_to_user']).optional(),
    title: z.string().optional(),
    workspaceId: z.string().optional(),
    model: z.string().optional(),
    thinkingEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/routing/message'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['to', 'body', 'kind', 'title', 'workspaceId', 'model', 'thinkingEffort']) {
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
    "Enable or disable an agent by `agentId` (`enabled` true/false). Only ENABLED agents join sessions as invokable subagents; a freshly created or installed agent starts enabled. Disabling also removes its .claude/agents mirror file. Fully reversible.",
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

export const setSessionStatus: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'set_session_status',
    "Set THIS conversation's status light — shown on its row in the user's Sessions panel and on the node screen. Set `completed` when the work you were asked for is done. Set `problem` when you are stuck and cannot proceed without help. Set `needs_input` when you reached a conclusion or decision that needs the user's attention (approvals are detected automatically — this is for conclusions). Include a short `note` saying why. The status clears itself when the user sends the next message. For the WORKSPACE-level light, use set_workspace_status instead.",
    {
    status: z.enum(['completed', 'problem', 'needs_input']),
    note: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/sessions/status'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['status', 'note']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const setTaskSteps: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'set_task_steps',
    "Lay out (or revise) a task's execution steps — the durable checklist the user watches on the task panel, where each row shows its steps and an n/m progress count. Send the task's COMPLETE current list every time: `steps` is an array of objects, each { \"title\": \"<short step in plain language>\", \"status\": \"open\" | \"in-progress\" | \"done\" }, in working order — the list is REPLACED wholesale, so omit a step and it disappears. Set `planId` when the steps come from a plan (create_plan first for medium/large work). Exactly one step should be \"in-progress\" at a time; update the list the moment a step starts or finishes. Titles are what the user reads (\"Draft the newsletter\"), never technical mechanics. Steps are the task's plan-of-record — they persist until the task is deleted. Do not narrate the bookkeeping in your reply.",
    {
    taskId: z.string(),
    workspaceId: z.string(),
    steps: z.array(z.object({
      title: z.string(),
      status: z.enum(['open', 'in-progress', 'done']),
    })),
    planId: z.string().nullable().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/tasks/{taskId}/steps'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{taskId}', encodeURIComponent(String(args['taskId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['steps', 'planId']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const setWorkspaceStatus: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'set_workspace_status',
    "Set this workspace's status light — the state the user sees on every navigation surface. Set `completed` when EVERY task on the list is done (do it before finishing your reply, so the user sees it before their next message). Set `problem` when you are stuck and cannot proceed without help. Set `needs_input` when you reached a conclusion or decision that needs the user's attention (approvals and questions are detected automatically — this is for conclusions). Include a short `note` saying why. The status clears itself when the user sends the next message.",
    {
    workspaceId: z.string(),
    status: z.enum(['completed', 'problem', 'needs_input']),
    note: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/status'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['status', 'note']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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
    "Speak a short message ALOUD to the user through their voice assistant. Pass plain, spoken-style prose — NO markdown, lists, code, or URLs; write it the way you would say it out loud, and keep it brief (a sentence or two). Use this to notify or answer the user by voice from a TEXT surface (typed chat, a schedule, a delivery); on the voice conversation itself you are already heard as you write and this tool is not available. Pass callId (from start_call/list_calls) to speak INTO a live call instead of the local speaker — for brief announcements only (the call session handles the conversation itself, and a participant talking can cut an announcement off mid-sentence). Returns { spoken: true } when it played, or { spoken: false, reason } when the voice assistant is not running (then reply in text instead) or the call is gone.",
    {
    text: z.string(),
    callId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/voice/speak'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['text', 'callId']) {
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

export const startCall: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'start_call',
    "Join a live meeting/call with Vynel's voice — AFTER the user has the call app open with its audio pointed at the virtual cable pair. This creates a dedicated call session (visible in the user's Sessions panel), attaches call audio to it, and announces Vynel's presence aloud. Pick the mode the user asked for: 'notetaker' (group calls — listens and takes notes, speaks only when addressed by name or when something truly warrants it) or 'participant' (one-to-one — converses naturally). Pass the user's goal so the call session knows what matters. Returns { started, callId, sessionId } — use speak with that callId for announcements (note: an announcement can be cut off mid-sentence if a participant starts talking), end_call when the meeting is over, and read the call session afterwards for what happened. One call at a time in this version. This does NOT open the call app or click Join — the user (or desktop control) does that. Ears scoping (Windows, when Vynel's own audio driver is installed): by default Vynel hears ALL system audio except its own voice — echo-free, but music and notifications leak into the call's hearing. When you know which app hosts the call, pass captureProcessName with its image name ('chrome' for a Google Meet tab in Chrome, 'msedge' for Edge, 'Zoom' for the Zoom app) so Vynel hears ONLY that app and its child processes — this noticeably improves how well Vynel hears the call. Prefer captureProcessName over capturePid (the raw process id form; give at most one of the two). Omit both only when you don't know the hosting app.",
    {
    label: z.string(),
    mode: z.enum(['notetaker', 'participant']).optional(),
    goal: z.string().optional(),
    capturePid: z.number().optional(),
    captureProcessName: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        const pathStr = '/voice/calls'
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['label', 'mode', 'goal', 'capturePid', 'captureProcessName']) {
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
    "Uninstall a marketplace item from this workspace by `itemId`. A skill uninstall hard-deletes its files (re-install is possible but any local edits are lost); an agent uninstall is a soft-delete; a plugin uninstall removes it via Claude Code's plugin system — but only from the Marketplace panel, not from here; MCP-server and rule uninstalls remove the config entry / rules file. Confirm intent when the user names the item loosely.",
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

export const uninstallSkill: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'uninstall_skill',
    "Uninstall a skill by `skillId`. `scope` is \"user\" (~/.claude/skills — available in every workspace) or \"workspace\" (<workspace>/.claude/skills; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). Removes the whole skill folder from disk (SKILL.md and every supporting file) and forgets it — the user's own, a discovered one, or a Marketplace install alike. Irreversible; confirm with the user unless they just asked for exactly this.",
    {
    skillId: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/skills/{skillId}'
        pathStr = pathStr.replace('{skillId}', encodeURIComponent(String(args['skillId'] ?? '')))
        const queryParams = new URLSearchParams()
        for (const k of ['scope', 'workspaceId']) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
        }
        const queryStr = queryParams.toString()
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
    "Update a registered app's name, command, folder, env file path, or port. A running app keeps its current process — the change applies on the next start (stop_app then start_app to restart with the new command).",
    {
    appId: z.string(),
    workspaceId: z.string(),
    name: z.string().optional(),
    command: z.string().optional(),
    cwdRelative: z.string().optional(),
    envFileRelative: z.string().optional(),
    port: z.number().nullable().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/apps/{appId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{appId}', encodeURIComponent(String(args['appId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['name', 'command', 'cwdRelative', 'envFileRelative', 'port']) {
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

export const updateFeature: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_feature',
    "Update a feature. Set status \"in-progress\" when work on it starts, back to \"open\" if it stalls, or \"done\" when it shipped (complete_feature is the shortcut). `description` REPLACES the full write-up — send the complete new text, not a diff. `phaseId` links the feature to the build-plan phase that delivers it; pass null to unlink. Statuses: open / in-progress / done.",
    {
    featureId: z.string(),
    workspaceId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    phaseId: z.string().nullable().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/features/{featureId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{featureId}', encodeURIComponent(String(args['featureId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'description', 'status', 'phaseId']) {
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
    "Update an installed marketplace skill or plugin to the newest catalog version, by `itemId`. Use when the item shows a newer version than the installed one. Skills download an integrity-verified artifact server-side that replaces the installed files; this tool also updates plugins, via Claude Code's own plugin system. Agents, MCP servers, and rules must be uninstalled and reinstalled instead.",
    {
    workspaceId: z.string(),
    itemId: z.string(),
    acceptPluginExecution: z.boolean().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/marketplace/update'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['itemId', 'acceptPluginExecution']) {
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

export const updateMySchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_my_schedule',
    "Update any schedule the user owns (global or workspace; find ids via list_my_schedules) — its displayName, promptTemplate (the reminder text or work prompt), cronExpression/timezone (the next fire recomputes), destination, or isEnabled. Only the fields you pass change.",
    {
    scheduleId: z.string(),
    displayName: z.string().optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    promptTemplate: z.string().optional(),
    destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
    channelId: z.string().nullable().optional(),
    catchUpOnMiss: z.boolean().optional(),
    approvalTimeoutMsOverride: z.number().nullable().optional(),
    isEnabled: z.boolean().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/schedules/{scheduleId}'
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['displayName', 'cronExpression', 'timezone', 'promptTemplate', 'destinationKind', 'channelId', 'catchUpOnMiss', 'approvalTimeoutMsOverride', 'isEnabled']) {
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

export const updatePhase: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_phase',
    "Update a phase. Set status \"in-progress\" when its build work starts, back to \"open\" if it stalls, or \"done\" when the stage landed (complete_phase is the shortcut). `description` REPLACES the full write-up — send the complete new text, not a diff. `orderIndex` moves the phase within the build order when the plan is reshaped. Statuses: open / in-progress / done.",
    {
    phaseId: z.string(),
    workspaceId: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    orderIndex: z.number().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/phases/{phaseId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{phaseId}', encodeURIComponent(String(args['phaseId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'description', 'status', 'orderIndex']) {
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
    "Update a plan. Set status \"in-progress\" when its day's work starts, back to \"open\" if it stalls, or \"done\" when everything landed (complete_plan is the shortcut). `planDate` moves the plan to another day when the user reschedules; title/detail edits keep the wording current; `taskId` attaches the plan to the task it executes (null detaches). Statuses: open / in-progress / done.",
    {
    planId: z.string(),
    workspaceId: z.string(),
    title: z.string().optional(),
    detail: z.string().nullable().optional(),
    planDate: z.string().optional(),
    status: z.enum(['open', 'in-progress', 'done']).optional(),
    taskId: z.string().nullable().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/plans/{planId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{planId}', encodeURIComponent(String(args['planId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['title', 'detail', 'planDate', 'status', 'taskId']) {
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

export const updateSchedule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'update_schedule',
    "Update a schedule in the active workspace — its displayName, promptTemplate (the reminder text or work prompt), cronExpression/timezone (the next fire recomputes), destination, or isEnabled. Only the fields you pass change.",
    {
    scheduleId: z.string(),
    workspaceId: z.string(),
    displayName: z.string().optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    promptTemplate: z.string().optional(),
    destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
    channelId: z.string().nullable().optional(),
    catchUpOnMiss: z.boolean().optional(),
    approvalTimeoutMsOverride: z.number().nullable().optional(),
    isEnabled: z.boolean().optional(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/workspaces/{workspaceId}/schedules/{scheduleId}'
        pathStr = pathStr.replace('{workspaceId}', encodeURIComponent(String(args['workspaceId'] ?? scope.workspaceId ?? '')))
        pathStr = pathStr.replace('{scheduleId}', encodeURIComponent(String(args['scheduleId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['displayName', 'cronExpression', 'timezone', 'promptTemplate', 'destinationKind', 'channelId', 'catchUpOnMiss', 'approvalTimeoutMsOverride', 'isEnabled']) {
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

export const writeAgentFile: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'write_agent_file',
    "Create or replace ONE hand-authored subagent file — `<root>/.claude/agents/<slug>.md`, a plain Claude Code subagent (NOT a Vynel agent: for those use create_agent / update_agent). `slug` is the file name (kebab-case); `scope` is \"user\" (~/.claude/agents — every workspace) or \"workspace\" (+ `workspaceId`, defaults to the active workspace; on the global surface pass it explicitly); `content` is the whole file: a frontmatter block with `name: <slug>`, a `description` (when to delegate to it), optional `tools` (comma list) and `model`, then the system prompt. Refuses a slug that already names a Vynel agent at that scope, or a file Vynel manages. Read it with list_agent_files first when editing. Mutating.",
    {
    slug: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    content: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/agents/files/{slug}'
        pathStr = pathStr.replace('{slug}', encodeURIComponent(String(args['slug'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'workspaceId', 'content']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const writeCommand: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'write_command',
    "Create or replace ONE slash command — a reusable prompt the user runs by typing \"/<commandName>\" (kebab-case; a \":\" groups commands in a folder, e.g. \"git:commit\"). `scope` is \"user\" (~/.claude/commands — runnable in every workspace) or \"workspace\" (<workspace>/.claude/commands; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). `body` is the prompt Claude runs (markdown; \"$ARGUMENTS\" stands for what the user types after the name); `description` is the one-line summary shown in the \"/\" menu; `argumentHint` (optional) names the expected arguments, e.g. \"[pr-number]\". Replaces the file — read it with list_commands first when editing; frontmatter keys you did not send are kept. Only write a command when the user asked for one. Mutating.",
    {
    commandName: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    description: z.string().nullable().optional(),
    argumentHint: z.string().nullable().optional(),
    body: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/commands/{commandName}'
        pathStr = pathStr.replace('{commandName}', encodeURIComponent(String(args['commandName'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'workspaceId', 'description', 'argumentHint', 'body']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const writeRule: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'write_rule',
    "Create or replace ONE rule file — a standing instruction Claude follows in every future session at that scope. `ruleId` becomes `<ruleId>.md` (kebab-case, e.g. \"git-hygiene\"); `scope` is \"user\" (~/.claude/rules — applies in every workspace) or \"workspace\" (<workspace>/.claude/rules; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). `content` is the whole markdown file (open with a `# Title` heading, then the instructions in plain words). Replaces the file entirely — read it with list_rules first when editing. Saving over a Marketplace-installed rule turns it into the user's own copy (Marketplace updates stop applying). Only write a rule when the user asked for a standing instruction; a fact about them belongs in memory, not here. Mutating.",
    {
    ruleId: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    content: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/rules/{ruleId}'
        pathStr = pathStr.replace('{ruleId}', encodeURIComponent(String(args['ruleId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'workspaceId', 'content']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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

export const writeSkillFile: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    'write_skill_file',
    "Write ONE text file into an installed skill's folder by `skillId`. `scope` is \"user\" (~/.claude/skills — available in every workspace) or \"workspace\" (<workspace>/.claude/skills; + `workspaceId`, defaults to the active workspace; on the global surface there is none, so pass it explicitly). `relativePath` is inside the skill folder (e.g. \"references/style.md\" — folders are created; no \"..\", no hidden names); `content` replaces the whole file. Writing \"SKILL.md\" must keep a frontmatter with `name: <skillId>` and a `description`, or Claude Code stops loading the skill. Read the file first with get_skill when editing. Mutating.",
    {
    skillId: z.string(),
    scope: z.enum(['user', 'workspace']),
    workspaceId: z.string().optional(),
    relativePath: z.string(),
    content: z.string(),
  },
    async (args: Record<string, unknown>) => {
      try {
        let pathStr = '/skills/{skillId}/files'
        pathStr = pathStr.replace('{skillId}', encodeURIComponent(String(args['skillId'] ?? '')))
        const queryStr = ''
        const bodyObj: Record<string, unknown> = {}
        for (const k of ['scope', 'workspaceId', 'relativePath', 'content']) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }
        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
        }
        const requestBody = JSON.stringify(bodyObj)
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: requestBody })
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
  completeFeature,
  completePhase,
  completePlan,
  completeTask,
  createAgent,
  createFeature,
  createMemoryEntry,
  createMonitor,
  createPhase,
  createPlan,
  createSchedule,
  createTask,
  deleteAgent,
  deleteFeature,
  deletePhase,
  disableSchedule,
  discoverInstalledSkillsForProvider,
  enableSchedule,
  getAgent,
  getAiAgentProviderAuthStatus,
  getAppLogs,
  getBackgroundProcess,
  getChatSession,
  getCurrentUser,
  getFeature,
  getIndexerStatus,
  getKnowledgeDocument,
  getMarketplaceItem,
  getPhase,
  getUserPreferences,
  getWorkspace,
  getWorkspaceBrief,
  getWorkspaceGitFacts,
  installCuratedAgent,
  installMarketplaceItem,
  killBackgroundProcess,
  listAgents,
  listAiAgentProviders,
  listAllowedSenders,
  listApps,
  listAvailableChatModels,
  listAvailableSkills,
  listBackgroundProcesses,
  listCapabilities,
  listChannels,
  listChatSessions,
  listCuratedAgents,
  listFeatures,
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
  listPhases,
  listPlans,
  listScheduleRuns,
  listScheduleTemplates,
  listSchedules,
  listTasks,
  listWorkspaceGroups,
  listWorkspaces,
  removeKnowledgeSource,
  runBackgroundProcess,
  searchChatMessages,
  searchKnowledge,
  searchMemory,
  sendMessage,
  setAgentEnabled,
  setSessionStatus,
  setTaskSteps,
  setWorkspaceStatus,
  startApp,
  stopApp,
  stopMonitor,
  uninstallMarketplaceItem,
  updateAgent,
  updateApp,
  updateFeature,
  updateMarketplaceItem,
  updateMemoryEntry,
  updatePhase,
  updatePlan,
  updateSchedule,
  updateTask,
]

// Routing tools (agent-base Slice 4) — the GLOBAL-ROOT turn's server ONLY.
// Kept OUT of generatedMcpTools so the normal chat turn stays byte-for-byte.
export const generatedRoutingMcpTools: McpToolFactory[] = [
  createGlobalMonitor,
  createMySchedule,
  createSession,
  createSkill,
  deleteAgentFile,
  deleteCommand,
  deleteRule,
  deleteSkillFile,
  disableMySchedule,
  displayAddWidget,
  displayClear,
  displayListWidgets,
  displayRemoveWidget,
  displayUpdateWidget,
  enableMySchedule,
  endCall,
  getBackgroundProcess,
  getChatSession,
  getDelegatedTask,
  getSkill,
  killBackgroundProcess,
  listAgentFiles,
  listBackgroundProcesses,
  listCalls,
  listCommands,
  listDelegatedTasks,
  listGlobalMonitors,
  listMySchedules,
  listRoutingChannels,
  listRoutingWorkspaces,
  listRules,
  listSessions,
  registerWorkspace,
  replyToChannel,
  runBackgroundProcess,
  searchChatMessages,
  sendMessage,
  sendToChannel,
  setSessionStatus,
  speak,
  startCall,
  stopGlobalMonitor,
  uninstallSkill,
  updateMySchedule,
  writeAgentFile,
  writeCommand,
  writeRule,
  writeSkillFile,
]

// Session-library Slice ④b (widened 2026-07-21) — tools ALSO exposed on
// workspace-root turns (x-mcp.workspaceInteractiveSurface): the interactive
// chat stream AND delegated workspace-root runs compose this array; schedule
// fires and spawned-session targets never see it.
export const generatedWorkspaceInteractiveMcpTools: McpToolFactory[] = [
  createSession,
  createSkill,
  deleteAgentFile,
  deleteCommand,
  deleteRule,
  deleteSkillFile,
  displayAddWidget,
  displayClear,
  displayListWidgets,
  displayRemoveWidget,
  displayUpdateWidget,
  getDelegatedTask,
  getSkill,
  listAgentFiles,
  listCommands,
  listDelegatedTasks,
  listRules,
  listSessions,
  replyToChannel,
  uninstallSkill,
  writeAgentFile,
  writeCommand,
  writeRule,
  writeSkillFile,
]

// The ask-approval tier — DELETE-method routes + x-mcp.askApproval opt-ins.
// Fed into the descriptors' askModeApprovalToolNames: these card ONLY in ask
// mode (auto/bypass run them uncarded). Full tool names under the 'vynel'
// server prefix, matching the descriptor layer's hardcoded server name.
export const generatedAskModeApprovalToolNames: string[] = [
  'mcp__vynel__create_my_schedule',
  'mcp__vynel__create_schedule',
  'mcp__vynel__delete_agent',
  'mcp__vynel__delete_agent_file',
  'mcp__vynel__delete_command',
  'mcp__vynel__delete_feature',
  'mcp__vynel__delete_phase',
  'mcp__vynel__delete_rule',
  'mcp__vynel__delete_skill_file',
  'mcp__vynel__disable_my_schedule',
  'mcp__vynel__disable_schedule',
  'mcp__vynel__enable_my_schedule',
  'mcp__vynel__enable_schedule',
  'mcp__vynel__end_call',
  'mcp__vynel__register_workspace',
  'mcp__vynel__remove_knowledge_source',
  'mcp__vynel__run_background_process',
  'mcp__vynel__start_call',
  'mcp__vynel__uninstall_marketplace_item',
  'mcp__vynel__uninstall_skill',
  'mcp__vynel__update_my_schedule',
  'mcp__vynel__update_schedule',
  'mcp__vynel__write_rule',
]

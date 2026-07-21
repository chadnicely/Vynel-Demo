// The `vynel` MCP feature descriptors — the route-derived in-process server
// expressed as `McpFeatureDescriptor`s the turn composer (`composeSessionMcpServers`)
// attaches to a turn uniformly (alongside any future feature). Hand-written
// wrappers around the generated-array builders — the generator + parity pipeline
// stay untouched; only this thin descriptor layer is new.
//
// THREE descriptors because the `vynel` server carries a DIFFERENT toolset per turn
// type, all under the same `mcp__vynel__*` prefix (they never coexist in one turn):
//   - workspace turn (background: schedule fires, delegated runs)
//       → the full route registry (`buildInProcessMcpServer`)
//   - workspace INTERACTIVE chat stream (Slice ④b)
//       → the registry + the session-spawning tools (`buildWorkspaceInteractiveMcpServer`)
//   - global-root turn → the routing tools only (`buildGlobalRootMcpServer`)
//
// `context.db` is `unknown` in the dependency-light contract; this is the producer
// boundary that owns the `vynel` server, so it casts to `Database` once (documented).

import type { Database } from '@vynel/db'
import type { McpFeatureDescriptor, SessionToolContext } from '@vynel/mcp-contract'
import type { McpScope } from './mcp-types.js'
import {
  buildInProcessMcpServer,
  buildGlobalRootMcpServer,
  buildWorkspaceInteractiveMcpServer,
} from './build-in-process-server.js'

// The MCP tools each capability owns (server name `vynel` → `mcp__vynel__<x-mcp
// name>`); the composer denies a capability's tools when that capability is off.
// Aligned to KLONE's ACTUAL generated registry: `knowledge` (all 7 tools) and
// `memory` (all 6 — 3 reads + 3 mutatingApproved writes) each gate together —
// a capability OFF means none of its tools at all. skills/channels/schedules
// tools stay ungated.
const VYNEL_CAPABILITY_GATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  knowledge: [
    'mcp__vynel__search_knowledge',
    'mcp__vynel__list_knowledge_documents',
    'mcp__vynel__get_knowledge_document',
    'mcp__vynel__get_indexer_status',
    'mcp__vynel__list_knowledge_sources',
    'mcp__vynel__add_to_knowledge',
    'mcp__vynel__remove_knowledge_source',
  ],
  memory: [
    'mcp__vynel__list_memory_entries',
    'mcp__vynel__search_memory',
    'mcp__vynel__list_memory_tags',
    'mcp__vynel__create_memory_entry',
    'mcp__vynel__update_memory_entry',
    'mcp__vynel__add_memory_from_file',
  ],
  tasks: [
    'mcp__vynel__list_tasks',
    'mcp__vynel__create_task',
    'mcp__vynel__update_task',
    'mcp__vynel__complete_task',
    'mcp__vynel__list_my_tasks',
  ],
}

// The standing task-list discipline for a workspace turn. Self-contained (the
// tools it names are this descriptor's own) and dropped when the `tasks`
// capability is off — the capability-aware contributePrompt below reads the
// same enabled-set the composer gates the tools with, so the prompt and the
// tools can never disagree.
const TASKS_PROMPT_INSTRUCTIONS = [
  '## Task list',
  'The user sees a task list you maintain (create_task / update_task / complete_task / ' +
    'list_tasks). When work has more than one step — or the user asks for something you will do ' +
    'later — track it: check list_tasks first, create one task per distinct piece of work in ' +
    'plain language the user recognizes, set it in-progress when you start, and complete it the ' +
    'moment it is finished and verified. Keep the list current as you go; never narrate the ' +
    'bookkeeping.',
].join('\n')

function toMcpScope(context: SessionToolContext): McpScope {
  return {
    // The one documented producer-boundary cast — see file header.
    db: context.db as Database,
    userId: context.userId,
    ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
  }
}

// The full route-derived registry for a WORKSPACE turn. `mutatingToolNames` is
// EMPTY today: KLONE's only mutating vynel tools (`add_to_knowledge`,
// `remove_knowledge_source`) are exposed with `x-mcp.mutatingApproved` (auto —
// no card, per the current approval stance). When the real approval card lands,
// they move here so the composer unions them into the backstop.
// One prompt contribution for both workspace descriptors — the interactive
// variant differs ONLY in its toolset, never in its standing guidance.
const contributeWorkspacePrompt: NonNullable<McpFeatureDescriptor['contributePrompt']> = (
  _context,
  enabledCapabilityIds,
) => (enabledCapabilityIds?.has('tasks') === true ? TASKS_PROMPT_INSTRUCTIONS : null)

export const vynelWorkspaceDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  build: (context) => buildInProcessMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: [],
  capabilityGatedTools: VYNEL_CAPABILITY_GATED_TOOLS,
  contributePrompt: contributeWorkspacePrompt,
}

// The workspace INTERACTIVE chat stream's variant (session-library Slice ④b):
// everything `vynelWorkspaceDescriptor` carries PLUS the session-spawning tools
// (create_session / list_sessions / send_task_to_session — the
// `generatedWorkspaceInteractiveMcpTools` set). Composed ONLY by the interactive
// stream (`streams/chat-turn.ts`, and the /context report that mirrors it) —
// background workspace turns (schedule fires, delegated runs) keep the plain
// workspace descriptor and never see the spawning tools. The spawning tools are
// mutatingApproved-auto (Chad's "Claude manages freely" precedent, like the root
// surface), so `mutatingToolNames` stays empty here too.
export const vynelWorkspaceInteractiveDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  build: (context) => buildWorkspaceInteractiveMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: [],
  capabilityGatedTools: VYNEL_CAPABILITY_GATED_TOOLS,
  contributePrompt: contributeWorkspacePrompt,
}

// The brain's tools for a GLOBAL-ROOT turn: the routing tools (SEE workspaces +
// DELEGATE, never read them) plus `register_workspace` — a rootSurface tool that
// lets the user set up a new workspace from the global conversation. No
// capability gate. `register_workspace` is mutating, so it's declared here and
// the composer unions it into the approval backstop → it cards on use.
export const vynelRoutingDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  build: (context) => buildGlobalRootMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: ['mcp__vynel__register_workspace'],
}

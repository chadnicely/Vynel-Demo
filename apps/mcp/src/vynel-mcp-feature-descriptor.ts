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
import { generatedAskModeApprovalToolNames } from './generated/api-tools.js'

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
  // `tasks` owns BOTH halves of the work-tracking leaf: the durable task list
  // and the per-session working steps (`set_todos`) — one toggle, because a
  // user turning "Tasks" off means "stop keeping lists for me".
  tasks: [
    'mcp__vynel__list_tasks',
    'mcp__vynel__create_task',
    'mcp__vynel__update_task',
    'mcp__vynel__complete_task',
    'mcp__vynel__list_my_tasks',
    'mcp__vynel__set_todos',
  ],
  plans: [
    'mcp__vynel__list_plans',
    'mcp__vynel__create_plan',
    'mcp__vynel__update_plan',
    'mcp__vynel__complete_plan',
    'mcp__vynel__list_my_plans',
  ],
  phases: [
    'mcp__vynel__list_phases',
    'mcp__vynel__create_phase',
    'mcp__vynel__get_phase',
    'mcp__vynel__update_phase',
    'mcp__vynel__complete_phase',
    'mcp__vynel__delete_phase',
  ],
  features: [
    'mcp__vynel__list_features',
    'mcp__vynel__create_feature',
    'mcp__vynel__get_feature',
    'mcp__vynel__update_feature',
    'mcp__vynel__complete_feature',
    'mcp__vynel__delete_feature',
  ],
  journal: [
    'mcp__vynel__list_journal_entries',
    'mcp__vynel__add_journal_entry',
    'mcp__vynel__list_my_journal_entries',
  ],
}

// The TIER map for the workspace registries — `HubFeatureKey` → the tools
// whose routes re-enter through that key's `featureGate` mount (app.ts).
// Composition-level filtering makes an out-of-tier tool INVISIBLE instead of
// a 403 at call time. `channels` is deliberately absent (basic tier carries
// it — gating it would be a no-op); curated agents ride the ungated /agents
// routes. Keys + names are pinned against the real contract + registry by
// vynel-mcp-feature-descriptor.test.ts.
const VYNEL_FEATURE_GATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  apps: [
    'mcp__vynel__list_apps',
    'mcp__vynel__add_app',
    'mcp__vynel__update_app',
    'mcp__vynel__start_app',
    'mcp__vynel__stop_app',
    'mcp__vynel__get_app_logs',
  ],
  schedules: [
    'mcp__vynel__list_schedules',
    'mcp__vynel__list_my_schedules',
    'mcp__vynel__list_schedule_runs',
    'mcp__vynel__list_schedule_templates',
  ],
  marketplace: [
    'mcp__vynel__list_marketplace_items',
    'mcp__vynel__get_marketplace_item',
    'mcp__vynel__install_marketplace_item',
    'mcp__vynel__uninstall_marketplace_item',
    'mcp__vynel__update_marketplace_item',
  ],
  knowledge: VYNEL_CAPABILITY_GATED_TOOLS['knowledge']!,
  memory: VYNEL_CAPABILITY_GATED_TOOLS['memory']!,
}

// The routing surface's tier map: the call/voice lifecycle tools dispatch
// through the `/voice/*` featureGate mount.
const ROUTING_FEATURE_GATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  voice: [
    'mcp__vynel__speak',
    'mcp__vynel__start_call',
    'mcp__vynel__end_call',
    'mcp__vynel__list_calls',
  ],
}

// The standing per-capability disciplines for a workspace turn. Each section
// is self-contained (the tools it names are this descriptor's own) and
// dropped when its capability is off — the capability-aware contributePrompt
// below reads the same enabled-set the composer gates the tools with, so the
// prompt and the tools can never disagree.
const TASKS_PROMPT_INSTRUCTIONS = [
  '## Task list',
  'The user sees a task list you maintain (create_task / update_task / complete_task / ' +
    'list_tasks). When work has more than one step — or the user asks for something you will do ' +
    'later — track it: check list_tasks first, create one task per distinct piece of work in ' +
    'plain language the user recognizes, set it in-progress when you start, and complete it the ' +
    'moment it is finished and verified. Keep the list current as you go; never narrate the ' +
    'bookkeeping.',
].join('\n')

// The working-steps dock (session-todos): the step-level twin of the task
// list. Contributed on EVERY surface — workspace turns gate it behind `tasks`
// (below), the global root gets it ungated (it has no capability rows).
const TODOS_PROMPT_INSTRUCTIONS = [
  '## Working steps',
  'The user watches a small step list under the chat, and you keep it with set_todos. Use it the ' +
    'way you use your own todo list: the moment a request needs more than a couple of steps, send ' +
    'the whole list (title + status per step), mark the one you are on "in-progress", and send the ' +
    'list again with it "done" the moment it is finished — one step in progress at a time. Send an ' +
    'empty list when the work is done and the dock should clear. Titles are plain language the ' +
    'user recognizes, never technical mechanics. Never narrate the bookkeeping.',
].join('\n')

const PLANS_PROMPT_INSTRUCTIONS = [
  '## Plans',
  'The user keeps date-wise plans (create_plan / update_plan / complete_plan / list_plans) — ' +
    'what each calendar day is for. When the user lays out dated intent, capture it as a plan ' +
    "(planDate YYYY-MM-DD) and break its work into tasks linked via the task's planId. Check " +
    'list_plans when asked what is planned or before planning dated work; complete a plan when ' +
    "its day's work has landed. Never narrate the bookkeeping.",
  'When a plan is worth the user\'s review — you just created or reshaped one — link it in ' +
    'your reply as [<plan title>](vynel://plan/<planId>); in the Vynel app it opens a review ' +
    'card showing the plan and its work items (other surfaces, e.g. Telegram, see plain text ' +
    'or a dead link — mention the plan by name there instead). Link at most one or two per ' +
    'reply, where it reads naturally.',
].join('\n')

const PHASES_PROMPT_INSTRUCTIONS = [
  '## Build plan (phases)',
  'The user keeps an engineering build plan (list_phases / get_phase / create_phase / ' +
    'update_phase / complete_phase) — how the app gets built, stage by stage. When the user lays ' +
    'out how to build something, capture each stage as a phase whose description is the FULL ' +
    'write-up (scope, pieces, decisions, what "done" means) — not a one-liner. list_phases shows ' +
    'previews only; read get_phase before working a stage so the full plan grounds the work. ' +
    'Move statuses as stages land. Never narrate the bookkeeping.',
].join('\n')

const FEATURES_PROMPT_INSTRUCTIONS = [
  '## Feature catalog',
  'The user keeps a feature catalog (list_features / get_feature / create_feature / ' +
    'update_feature / complete_feature) — what the app should have, each a FULL write-up of what ' +
    'it does and how it behaves. When the user describes functionality, capture it as a feature ' +
    "and link it to the build phase that delivers it via `phaseId`. list_features shows previews " +
    'only; read get_feature before building one. Complete a feature when it shipped and was ' +
    'verified. Never narrate the bookkeeping.',
].join('\n')

const JOURNAL_PROMPT_INSTRUCTIONS = [
  '## Work journal',
  'The user keeps a daily work journal (add_journal_entry / list_journal_entries). When you ' +
    'pick work back up, read the recent entries to understand the flow of the last days. When ' +
    'meaningful work lands, append one dated entry (entryDate YYYY-MM-DD) saying what happened ' +
    'and what was decided, in plain language. The journal is append-only for you — write ' +
    'entries as a faithful record; never narrate the bookkeeping.',
].join('\n')

// Section order is stable (tasks → todos → plans → phases → features →
// journal) so the composed prompt never reshuffles between turns. Tasks and
// todos share the `tasks` capability — the durable list and its step-level
// twin ride one toggle.
const CAPABILITY_PROMPT_SECTIONS: readonly { capabilityId: string; section: string }[] = [
  { capabilityId: 'tasks', section: TASKS_PROMPT_INSTRUCTIONS },
  { capabilityId: 'tasks', section: TODOS_PROMPT_INSTRUCTIONS },
  { capabilityId: 'plans', section: PLANS_PROMPT_INSTRUCTIONS },
  { capabilityId: 'phases', section: PHASES_PROMPT_INSTRUCTIONS },
  { capabilityId: 'features', section: FEATURES_PROMPT_INSTRUCTIONS },
  { capabilityId: 'journal', section: JOURNAL_PROMPT_INSTRUCTIONS },
]

function toMcpScope(context: SessionToolContext): McpScope {
  return {
    // The one documented producer-boundary cast — see file header.
    db: context.db as Database,
    userId: context.userId,
    ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
  }
}

// The full route-derived registry for a WORKSPACE turn. `mutatingToolNames`
// stays EMPTY (no vynel tool cards in EVERY mode); the ask-approval tier
// (`generatedAskModeApprovalToolNames` — DELETE routes + x-mcp.askApproval)
// cards in ask mode only, per Chad's 2026-07-26 approval stance.
// One prompt contribution for both workspace descriptors — the interactive
// variant differs ONLY in its toolset, never in its standing guidance.
const contributeWorkspacePrompt: NonNullable<McpFeatureDescriptor['contributePrompt']> = (
  _context,
  enabledCapabilityIds,
) => {
  const sections = CAPABILITY_PROMPT_SECTIONS.filter(
    (entry) => enabledCapabilityIds?.has(entry.capabilityId) === true,
  ).map((entry) => entry.section)
  return sections.length > 0 ? sections.join('\n\n') : null
}

export const vynelWorkspaceDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  build: (context) => buildInProcessMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: [],
  askModeApprovalToolNames: generatedAskModeApprovalToolNames,
  capabilityGatedTools: VYNEL_CAPABILITY_GATED_TOOLS,
  featureGatedTools: VYNEL_FEATURE_GATED_TOOLS,
  contributePrompt: contributeWorkspacePrompt,
}

// The workspace-root's FULL variant (session-library Slice ④b, widened
// 2026-07-21): everything `vynelWorkspaceDescriptor` carries PLUS the
// session-routing tools (create_session / list_sessions / send_message —
// the `generatedWorkspaceInteractiveMcpTools` set). Composed by the interactive
// stream (`streams/chat-turn.ts`, the /context report that mirrors it) AND by
// DELEGATED workspace-root runs (`buildDelegatedTurnMcpComposer` — a delegated
// turn is the user's own request via the global root, and the primary's toolset
// must not flip per turn origin: the deferred-tool "dropped again" lesson).
// Schedule fires and spawned-session targets keep the plain workspace
// descriptor — a truly autonomous turn never gains spawning tools, and a
// spawned session is the leaf, not a router. The spawning tools are
// mutatingApproved-auto (Chad's "Claude manages freely" precedent, like the root
// surface), so `mutatingToolNames` stays empty here too.
export const vynelWorkspaceInteractiveDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  build: (context) => buildWorkspaceInteractiveMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: [],
  askModeApprovalToolNames: generatedAskModeApprovalToolNames,
  capabilityGatedTools: VYNEL_CAPABILITY_GATED_TOOLS,
  featureGatedTools: VYNEL_FEATURE_GATED_TOOLS,
  contributePrompt: contributeWorkspacePrompt,
}

// The brain's tools for a GLOBAL-ROOT turn: the routing tools (SEE workspaces +
// DELEGATE, never read them) plus `register_workspace` — a rootSurface tool that
// lets the user set up a new workspace from the global conversation. No
// capability gate. `register_workspace` rides the generated ask-approval tier
// (route-level `x-mcp.askApproval`) — Chad 2026-07-26 dropped it from the
// every-mode set: it cards in ask mode, runs uncarded in auto/bypass.
// The root keeps working steps too (`set_todos` rides both surfaces) — the
// dock is per SESSION, and the global chat is a session like any other. The
// section is contributed UNGATED here: the root has no workspace, so no
// capability rows can exist for it, and a single-entry `capabilityGatedTools`
// would make the composer drop this descriptor's whole prompt the moment that
// one capability went missing.
export const vynelRoutingDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  build: (context) => buildGlobalRootMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: [],
  askModeApprovalToolNames: generatedAskModeApprovalToolNames,
  featureGatedTools: ROUTING_FEATURE_GATED_TOOLS,
  contributePrompt: () => TODOS_PROMPT_INSTRUCTIONS,
}

// The `vynel` server's DECLARED tool inventories + gate maps — extracted from
// the descriptor file (its 300-line tripwire fired) and shared with the
// session-tool-catalog assembler. Inventories DERIVE from the generated
// factory names, so the catalog/admin surface cannot drift from what the
// servers actually register.

import {
  generatedAskModeApprovalToolNames,
  generatedMcpTools,
  generatedRoutingMcpTools,
  generatedWorkspaceInteractiveMcpTools,
} from './generated/api-tools.js'

// Re-exported for the catalog assembler (the curated ask-card tier).
export { generatedAskModeApprovalToolNames }

// The declared inventories are DERIVED from the generated registry (factory
// function names are the camelCase tool names), so the catalog/admin surface
// can never drift from what the servers actually register.
export const camelToSnake = (value: string): string =>
  value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)
export const toVynelToolNames = (factories: readonly { name: string }[]): readonly string[] =>
  factories.map((factory) => `mcp__vynel__${camelToSnake(factory.name)}`)
export const WORKSPACE_TOOL_NAMES = toVynelToolNames(generatedMcpTools)
export const WORKSPACE_INTERACTIVE_TOOL_NAMES = [
  ...WORKSPACE_TOOL_NAMES,
  ...toVynelToolNames(generatedWorkspaceInteractiveMcpTools),
]
export const ROUTING_TOOL_NAMES = toVynelToolNames(generatedRoutingMcpTools)


// The MCP tools each capability owns (server name `vynel` → `mcp__vynel__<x-mcp
// name>`); the composer denies a capability's tools when that capability is off.
// Aligned to KLONE's ACTUAL generated registry: `knowledge` (all 7 tools) and
// `memory` (all 6 — 3 reads + 3 mutatingApproved writes) each gate together —
// a capability OFF means none of its tools at all. skills/channels/schedules
// tools stay ungated.
export const VYNEL_CAPABILITY_GATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
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
    'mcp__vynel__set_task_steps',
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
export const VYNEL_FEATURE_GATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
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
export const ROUTING_FEATURE_GATED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  voice: [
    'mcp__vynel__speak',
    'mcp__vynel__start_call',
    'mcp__vynel__end_call',
    'mcp__vynel__list_calls',
  ],
}

// Golden-shape test for the auto-generated MCP tool registry.
// Asserts the expected tool count + names match what the routes
// currently annotate. Drift here means a route added/removed/edited
// its `x-mcp` annotation — re-run `pnpm api:generate` and commit
// the regenerated file. The CI parity guard
// (`scripts/src/generators/check-mcp-parity.ts`) is the wider net
// (catches handler + schema drift too); this test is the fast
// canary for "did the tool list itself change?".

import { describe, expect, it } from 'vitest'
import {
  generatedMcpTools,
  generatedRoutingMcpTools,
  generatedWorkspaceInteractiveMcpTools,
} from './api-tools.js'

// The x-mcp-annotated route registry. Sorted to match the generator's
// stable-order emit. As each feature's routes land, its x-mcp tools join
// this list and the count updates in lockstep.
//   - knowledge (`apps/local-api/src/routes/knowledge/index.ts`): 4
//     read-only GETs + 2 mutating source tools (add_to_knowledge /
//     remove_knowledge_source, `mutatingApproved` auto-mode) + list_*.
//   - skills (`apps/local-api/src/routes/skills/index.ts`): 2 read-only
//     GETs (list_available_skills / list_installed_skills); the mutating
//     install/enable/disable/uninstall/settings routes carry NO x-mcp.
//   - channels (`apps/local-api/src/routes/channels/index.ts`): 2 read-only
//     GETs (list_channels / list_allowed_senders); the mutating
//     connect/disconnect/enable/disable/allowed-sender routes carry NO x-mcp
//     (connect carries the bot token — never an MCP tool).
//   - schedules (`apps/local-api/src/routes/schedules/index.ts`): 3 read-only
//     GETs (list_schedules / list_schedule_templates / list_schedule_runs);
//     the mutating create/update/enable/disable/delete routes carry NO x-mcp
//     (and the fire-now route is deferred entirely).
//   - channels USER-scoped (`.../routes/channels/user-scoped.ts`): 1 read-only
//     GET (list_my_channels — a user's global + workspace channels); every
//     mutating route (incl. connect, which carries the bot token) carries NO x-mcp.
//   - schedules USER-scoped (`.../routes/schedules/user-scoped.ts`): 1 read-only
//     GET (list_my_schedules — a user's global + workspace schedules); the
//     mutating create/update/enable/disable/delete routes carry NO x-mcp.
//   - the 2026-07-05 API-completion waves: memory (2 reads + create_memory_entry
//     mutatingApproved), chat (3 reads), workspaces (2 reads), users (2 reads),
//     providers (3 reads). Approvals routes carry NO x-mcp at all (the agent
//     never sees the approval surface); files/agents/capabilities/onboarding/
//     dashboard/root likewise expose nothing.
//   - the 2026-07-11 memory-tags round: +list_memory_tags (read) +
//     add_memory_from_file + update_memory_entry (both mutatingApproved — the
//     latter so the agent KEEPS context-tagged entries current).
//   - the tasks module (2026-07-17): list_tasks + list_my_tasks (reads) +
//     create_task / update_task / complete_task (mutatingApproved — the agent
//     SDK has no built-in task feature; these are how Claude keeps the user's
//     visible task list current). The user-scoped mutations (create/delete)
//     are NOT exposed — the agent creates through its workspace door only.
//   - the apps module (2026-07-17): list_apps + get_app_logs (reads) +
//     add_app / update_app / start_app / stop_app (mutatingApproved — NO
//     approval cards by design, Chad; the safety story is visibility +
//     the supervisor's cwd containment). DELETE stays user-only.
const EXPECTED_TOOL_NAMES = [
  'add_app',
  'add_memory_from_file',
  'add_to_knowledge',
  'complete_task',
  'create_memory_entry',
  'create_task',
  'discover_installed_skills_for_provider',
  'get_ai_agent_provider_auth_status',
  'get_app_logs',
  'get_chat_session',
  'get_current_user',
  'get_indexer_status',
  'get_knowledge_document',
  'get_user_preferences',
  'get_workspace',
  'list_ai_agent_providers',
  'list_allowed_senders',
  'list_apps',
  'list_available_skills',
  'list_channels',
  'list_chat_sessions',
  'list_installed_skills',
  'list_knowledge_documents',
  'list_knowledge_sources',
  'list_memory_entries',
  'list_memory_tags',
  'list_my_channels',
  'list_my_schedules',
  'list_my_tasks',
  'list_schedule_runs',
  'list_schedule_templates',
  'list_schedules',
  'list_tasks',
  'list_workspaces',
  'remove_knowledge_source',
  'search_chat_messages',
  'search_knowledge',
  'search_memory',
  'start_app',
  'stop_app',
  'update_app',
  'update_memory_entry',
  'update_task',
] as const

// The ROUTING (brain) tools live in a SEPARATE array — only the global-root
// turn's in-process server gets them, so the normal chat turn stays byte-for-
// byte. Membership is path-prefix `/routing/` OR `x-mcp.rootSurface: true`.
// Landed with the routing vertical (2026-07-05); `register_workspace` (the
// user sets up a workspace from the global conversation — rootSurface, mutating
// → cards) joined 2026-07-05; `speak` (rootSurface — any global session's voice
// output) joined 2026-07-08; the session-library tools `create_session` /
// `list_sessions` (rootSurface) + `send_task_to_session` (/routing/) joined
// 2026-07-21 (Slice ④).
const EXPECTED_ROUTING_TOOL_NAMES = [
  'create_session',
  'list_routing_channels',
  'list_routing_workspaces',
  'list_sessions',
  'register_workspace',
  'send_task_to_session',
  'send_task_to_workspace',
  'send_to_channel',
  'speak',
] as const

// Slice ④b: the session-spawning tools ALSO ride WORKSPACE INTERACTIVE chat
// streams — via a THIRD array (`x-mcp.workspaceInteractiveSurface`) that only
// `vynelWorkspaceInteractiveDescriptor` (streams/chat-turn.ts) composes. They
// are deliberately NOT in `generatedMcpTools`: that array feeds BACKGROUND
// workspace turns too (schedule fires via build-schedule-fire-deps), which must
// never see them (the background-exclusion test below pins this).
const EXPECTED_WORKSPACE_INTERACTIVE_TOOL_NAMES = [
  'create_session',
  'list_sessions',
  'send_task_to_session',
] as const

const snakeToCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

describe('generatedMcpTools', () => {
  it('exposes exactly the annotated tools (by name)', () => {
    expect(generatedMcpTools).toHaveLength(EXPECTED_TOOL_NAMES.length)
    // The generator names each factory export after its camelCased tool name,
    // so `.name` is the assertion surface (stronger than a bare count).
    expect(generatedMcpTools.map((f) => f.name).sort()).toEqual(
      EXPECTED_TOOL_NAMES.map(snakeToCamel).sort(),
    )
  })

  it('each entry is a factory function (per D5: `(scope, app) => Tool`)', () => {
    for (const factory of generatedMcpTools) {
      expect(typeof factory).toBe('function')
      expect(factory.length).toBe(2) // arity: (scope, app)
    }
  })
})

describe('generatedRoutingMcpTools', () => {
  it('exposes exactly the annotated routing tools (by name)', () => {
    expect(generatedRoutingMcpTools).toHaveLength(EXPECTED_ROUTING_TOOL_NAMES.length)
    expect(generatedRoutingMcpTools.map((f) => f.name).sort()).toEqual(
      EXPECTED_ROUTING_TOOL_NAMES.map(snakeToCamel).sort(),
    )
  })
})

describe('generatedWorkspaceInteractiveMcpTools (Slice ④b)', () => {
  it('exposes exactly the session-spawning tools (by name)', () => {
    expect(generatedWorkspaceInteractiveMcpTools).toHaveLength(
      EXPECTED_WORKSPACE_INTERACTIVE_TOOL_NAMES.length,
    )
    expect(generatedWorkspaceInteractiveMcpTools.map((f) => f.name).sort()).toEqual(
      EXPECTED_WORKSPACE_INTERACTIVE_TOOL_NAMES.map(snakeToCamel).sort(),
    )
  })

  it('background exclusion holds: none of them leak into generatedMcpTools (the schedule-fire / background-turn array)', () => {
    const backgroundNames = new Set(generatedMcpTools.map((f) => f.name))
    for (const name of EXPECTED_WORKSPACE_INTERACTIVE_TOOL_NAMES) {
      expect(backgroundNames.has(snakeToCamel(name))).toBe(false)
    }
  })
})

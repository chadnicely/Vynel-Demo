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
//     install/uninstall/settings routes carry NO x-mcp (skills are
//     install/uninstall-only — no enable/disable pair since 2026-08-01).
//   - channels (`apps/local-api/src/routes/channels/index.ts`): 2 read-only
//     GETs (list_channels / list_allowed_senders); the mutating
//     connect/disconnect/enable/disable/allowed-sender routes carry NO x-mcp
//     (connect carries the bot token — never an MCP tool).
//   - schedules (`apps/local-api/src/routes/schedules/index.ts`): 3 read-only
//     GETs (list_schedules / list_schedule_templates / list_schedule_runs) +
//     create/update/enable/disable (Kafi 2026-08-20, revising D14: "remind me
//     for tea at 5" typed in chat must create a real schedule row, not an
//     improvised sleep timer; all four ride the ask-approval tier). DELETE and
//     fire-now still carry NO x-mcp (fire-now DRIVES a turn — never a tool).
//   - channels USER-scoped (`.../routes/channels/user-scoped.ts`): 1 read-only
//     GET (list_my_channels — a user's global + workspace channels); every
//     mutating route (incl. connect, which carries the bot token) carries NO x-mcp.
//   - schedules USER-scoped (`.../routes/schedules/user-scoped.ts`):
//     list_my_schedules (rootSurface + workspaceSurface — both worlds, the
//     send_message shape) + the rootSurface create/update/enable/disable
//     *_my_* mutations (Kafi 2026-08-20: the GLOBAL surfaces' schedule door —
//     create_my_schedule takes scope 'global' | 'workspace'+workspaceId, its
//     union body flattened by the generator). DELETE stays unexposed.
//   - display (`.../routes/display/index.ts`, P2b 2026-08-21): the five board
//     tools — list/add/update/remove/clear, all rootSurface +
//     workspaceInteractiveSurface, all card class `never` (remove/clear are
//     POSTs precisely so they do NOT auto-join the ask tier). Gated by the
//     `display` capability, which defaults ON.
//   - the 2026-07-05 API-completion waves: memory (2 reads + create_memory_entry
//     mutatingApproved), chat (3 reads), workspaces (2 reads), users (2 reads),
//     providers (3 reads; +list_available_chat_models 2026-07-31 — the
//     discovered model roster, how agents learn legal `model` values now that
//     the request schemas dropped the closed enum). Approvals routes carry NO
//     x-mcp at all (the agent
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
//   - the plans module (2026-07-23): list_plans + list_my_plans (reads) +
//     create_plan / update_plan / complete_plan (mutatingApproved — the
//     date-wise layer above tasks; tasks link via their loose planId).
//   - the journal module (2026-07-23): list_journal_entries +
//     list_my_journal_entries (reads) + add_journal_entry (mutatingApproved).
//     APPEND-ONLY for the agent — the user-scoped edit/delete doors are
//     deliberately NOT exposed (history stays the user's).
//   - the monitors module (2026-07-26): list_monitors + create_monitor +
//     stop_monitor (mutatingApproved — a monitor is Claude's own bookkeeping).
//     Every op is DOUBLED on the routing array under a global-flavored name,
//     because the two surfaces are mutually exclusive and a turn that can arm
//     a watch must be able to stop it. There is no watchable-events tool: the
//     catalog is inlined into both create descriptions (see watchable-events.ts).
//   - send_message (2026-07-26; the three aliases it superseded —
//     send_task_to_workspace / send_task_to_session / report_to_requester —
//     were REMOVED 2026-08-04, persona-sessions A9): the ONE session-to-session
//     comms tool. It carries `x-mcp.workspaceSurface`, which keeps a ROOT tool
//     in the plain workspace array too — so it has ONE name on EVERY surface
//     (routing + workspace + interactive), which is why it appears in all three
//     expected lists below rather than exactly one. Upward sends from turns
//     with no caller-identity header answer 400 with an actionable note.
//   - task 4b exposure (2026-07-26, Chad: "expose all the useful tools"): the
//     agents module end-to-end (list/get/curated reads + create / install /
//     update / set-enabled mutations + delete_agent, which rides the
//     ask-approval tier via its DELETE method), list_capabilities (READ only —
//     the toggle stays user-only: an agent re-enabling its own denied tools
//     defeats the gate), and the workspace marketplace (browse reads +
//     install + uninstall, the latter ask-tier via x-mcp.askApproval — a skill
//     uninstall hard-deletes files).
// test: correct expectation — the engineering-plan modules (2026-08-11)
// added phases + features (list/create/get/update/complete reads+writes,
// mutatingApproved; delete_phase / delete_feature ride the ask tier via
// their DELETE method).
const EXPECTED_TOOL_NAMES = [
  'add_app',
  'add_journal_entry',
  'add_memory_from_file',
  'add_to_knowledge',
  'complete_feature',
  'complete_phase',
  'complete_plan',
  'complete_task',
  'create_agent',
  'create_feature',
  'create_memory_entry',
  'create_monitor',
  'create_phase',
  'create_plan',
  // The schedule mutations (Kafi 2026-08-20, revising D14) — chat creates
  // real schedule rows instead of improvising sleep timers; ask-tier carded.
  'create_schedule',
  'update_schedule',
  'enable_schedule',
  'disable_schedule',
  'create_task',
  'delete_agent',
  'delete_feature',
  'delete_phase',
  'discover_installed_skills_for_provider',
  'get_agent',
  'get_marketplace_item',
  'install_curated_agent',
  'get_ai_agent_provider_auth_status',
  'get_app_logs',
  'get_background_process',
  'get_chat_session',
  'get_current_user',
  'get_feature',
  'get_indexer_status',
  'get_knowledge_document',
  'get_phase',
  'get_user_preferences',
  'get_workspace',
  'list_agents',
  'list_ai_agent_providers',
  'list_allowed_senders',
  'kill_background_process',
  'list_apps',
  'list_available_chat_models',
  'list_available_skills',
  'list_capabilities',
  'list_channels',
  'list_chat_sessions',
  'list_curated_agents',
  'list_features',
  'list_installed_skills',
  'list_journal_entries',
  'list_knowledge_documents',
  'list_knowledge_sources',
  'list_memory_entries',
  'list_memory_tags',
  'list_background_processes',
  'list_monitors',
  'list_my_channels',
  'list_my_journal_entries',
  'list_my_plans',
  'list_marketplace_items',
  'list_my_schedules',
  'list_my_tasks',
  'list_phases',
  'list_plans',
  'list_schedule_runs',
  'list_schedule_templates',
  'list_schedules',
  'list_tasks',
  'list_workspaces',
  // Menu-tree folders (workspace redesign Arc 2b) — read-only list.
  'list_workspace_groups',
  'install_marketplace_item',
  'remove_knowledge_source',
  'run_background_process',
  'search_chat_messages',
  'search_knowledge',
  'search_memory',
  'send_message',
  'set_agent_enabled',
  // The working-steps dock (2026-08-02): `x-mcp.workspaceSurface` keeps it in
  // the plain workspace array alongside its routing membership below — one
  // name on every surface, so the toolset never flips per turn origin.
  'set_todos',
  // Task execution steps (2026-08-18): the task panel's durable per-task
  // checklist (whole-list replace, mutatingApproved like every task write);
  // workspace door only — tasks live per workspace, the global root routes.
  'set_task_steps',
  // The per-SESSION status light (Move 3, 2026-08-17) — the
  // set_workspace_status sibling on the ambient turn session (the set_todos
  // door); workspaceSurface + rootSurface so every conversation can set its
  // own light regardless of turn origin.
  'set_session_status',
  // The status vocabulary write (workspace redesign Arc 5b) — completed /
  // problem / needs_input, the state light every navigation surface renders.
  'set_workspace_status',
  'start_app',
  'stop_app',
  'stop_monitor',
  'uninstall_marketplace_item',
  'update_agent',
  'update_app',
  'update_feature',
  'update_marketplace_item',
  'update_memory_entry',
  'update_phase',
  'update_plan',
  'update_task',
] as const

// The ROUTING (brain) tools live in a SEPARATE array — only the global-root
// turn's in-process server gets them, so the normal chat turn stays byte-for-
// byte. Membership is path-prefix `/routing/` OR `x-mcp.rootSurface: true`.
// Landed with the routing vertical (2026-07-05); `register_workspace` (the
// user sets up a workspace from the global conversation — rootSurface, mutating
// → cards) joined 2026-07-05; `speak` (rootSurface — any global session's voice
// output) joined 2026-07-08; the session-library tools `create_session` /
// `list_sessions` (rootSurface) joined 2026-07-21 (Slice ④); the superseded
// task/report aliases were removed 2026-08-04 (persona-sessions A9).
const EXPECTED_ROUTING_TOOL_NAMES = [
  'create_global_monitor',
  // The user-scoped schedule tools (Kafi 2026-08-20): the GLOBAL surfaces'
  // schedule door — rootSurface mutations + the list (which ALSO keeps its
  // workspace membership via workspaceSurface, so it appears in both arrays).
  'create_my_schedule',
  'update_my_schedule',
  'enable_my_schedule',
  'disable_my_schedule',
  'list_my_schedules',
  'create_session',
  // The Display board (P2b, 2026-08-21): rootSurface + workspaceInteractiveSurface
  // — the global chat (and voice, which rides root) and a workspace conversation
  // both put things on screen; a schedule fire or a spawned leaf has nobody
  // watching, so they stay out of the plain workspace array. remove/clear are
  // POSTs, never DELETEs, so all five stay card class `never`: a card asking
  // permission to tidy a card off a screen costs more attention than it saves.
  'display_list_widgets',
  'display_add_widget',
  'display_update_widget',
  'display_remove_widget',
  'display_clear',
  // Voice-in-calls (merged 2026-08-13): the call lifecycle rides the ROOT
  // surface — the brain joins, lists and leaves calls; speak predates them.
  'end_call',
  // The cross-session conversation reads (2026-08-10): rootSurface +
  // workspaceSurface — every tier reads any owned session's messages through
  // ONE tool pair; the global root's own thread is walled off route-side.
  // The background-process quartet (Kafi, 2026-08-17): rootSurface +
  // workspaceSurface — one name on every surface, the send_message rule; a
  // background command is the same act from the brain or a workspace turn.
  'get_background_process',
  'get_chat_session',
  // Renamed from get_background_run / list_background_runs (Kafi, 2026-08-17):
  // "background run" read as an OS/shell process; these read tasks you SENT.
  'get_delegated_task',
  'kill_background_process',
  'list_background_processes',
  'list_calls',
  'list_delegated_tasks',
  'list_global_monitors',
  'list_routing_channels',
  'list_routing_workspaces',
  'list_sessions',
  'register_workspace',
  // The channel pipeline (2026-07-27): the model replies to the conversation
  // that drove the turn — addressed by the server-stamped ambient origin.
  'reply_to_channel',
  'run_background_process',
  // The cross-session search twin of get_chat_session (2026-08-10).
  'search_chat_messages',
  'send_message',
  'send_to_channel',
  // The per-SESSION status light (Move 3) — the global chat sets its own
  // light like any other conversation.
  'set_session_status',
  // The working-steps dock (2026-08-02): `rootSurface` + `workspaceSurface` —
  // the global chat is a session with a dock like any other.
  'set_todos',
  'speak',
  'start_call',
  'stop_global_monitor',
] as const

// Slice ④b (widened 2026-07-21): the session-routing tools ride workspace-ROOT
// turns — the interactive chat stream AND delegated workspace-root runs — via a
// THIRD array (`x-mcp.workspaceInteractiveSurface`) that only
// `vynelWorkspaceInteractiveDescriptor` composes. They are deliberately NOT in
// `generatedMcpTools`: that array feeds schedule fires and spawned-session
// targets, which must never see them (the exclusion test below pins this).
// send_message reaches interactive turns via the PLAIN array instead —
// workspaceSurface, not workspaceInteractiveSurface.
const EXPECTED_WORKSPACE_INTERACTIVE_TOOL_NAMES = [
  'create_session',
  // The Display board (P2b) — the same five names the root surface gets: a
  // workspace conversation writes to ITS own board (scope = that workspace id),
  // and one name everywhere keeps the toolset from flipping per turn origin.
  'display_list_widgets',
  'display_add_widget',
  'display_update_widget',
  'display_remove_widget',
  'display_clear',
  // The agent that can hand work off must be the agent that can read it back —
  // a workspace root delegates via send_message, so it needs these too.
  'get_delegated_task',
  'list_delegated_tasks',
  'list_sessions',
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

  it('the retired aliases are gone from EVERY array — send_message is the one comms tool', () => {
    const retired = ['reportToRequester', 'sendTaskToWorkspace', 'sendTaskToSession']
    const arrays = [
      generatedMcpTools.map((f) => f.name),
      generatedRoutingMcpTools.map((f) => f.name),
      generatedWorkspaceInteractiveMcpTools.map((f) => f.name),
    ]
    for (const arrayNames of arrays) {
      for (const name of retired) expect(arrayNames).not.toContain(name)
    }
    // send_message rides the plain + routing arrays (workspaceSurface keeps ONE
    // name on every surface; interactive turns compose the plain array too).
    expect(arrays[0]).toContain('sendMessage')
    expect(arrays[1]).toContain('sendMessage')
    expect(arrays[2]).not.toContain('sendMessage')
  })
})

describe('create_my_schedule (the first union-body tool)', () => {
  // The generator flattens a zod discriminatedUnion body (oneOf, no top-level
  // properties) into one tool schema: union of branch fields, discriminator
  // literals merged into an enum, branch-specific fields optional. Before the
  // flatten landed this emitted a BODY-LESS mutating tool — pin the shape so
  // a generator regression can't silently ship that again.
  type ToolDefinition = {
    name: string
    inputSchema: Record<string, { safeParse: (v: unknown) => { success: boolean } }>
  }
  const factory = generatedRoutingMcpTools.find((f) => f.name === 'createMySchedule')!
  const definition = factory(
    { db: {} as never, userId: 'user-1' },
    () => new Response('{}', { status: 200 }),
  ) as ToolDefinition

  it('advertises the flattened union body', () => {
    const keys = Object.keys(definition.inputSchema)
    expect(keys).toEqual(
      expect.arrayContaining(['scope', 'workspaceId', 'templateKind', 'cronExpression', 'fireAt']),
    )
  })

  it('merges the branch discriminator literals into one enum', () => {
    const scope = definition.inputSchema['scope']!
    expect(scope.safeParse('global').success).toBe(true)
    expect(scope.safeParse('workspace').success).toBe(true)
    expect(scope.safeParse('nonsense').success).toBe(false)
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

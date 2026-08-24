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
import {
  ROUTING_FEATURE_GATED_TOOLS,
  ROUTING_TOOL_NAMES,
  VYNEL_CAPABILITY_GATED_TOOLS,
  VYNEL_FEATURE_GATED_TOOLS,
  WORKSPACE_INTERACTIVE_TOOL_NAMES,
  WORKSPACE_TOOL_NAMES,
} from './vynel-tool-gates.js'

// The standing per-capability disciplines for a workspace turn. Each section
// is dropped when its capability is off — the capability-aware
// contributePrompt below reads the same enabled-set the composer gates the
// tools with, so the prompt and its OWN tools can never disagree. The tasks
// section deliberately crosses descriptors (ask_user, the task-planner
// notebook — the task-execution flow spans them); both carry graceful outs in
// their own guidance when absent on a surface.
const TASKS_PROMPT_INSTRUCTIONS = [
  '## Task list',
  'The task list is the workspace\'s WORK QUEUE, and you drain it (create_task / update_task / ' +
    'complete_task / list_tasks / set_task_steps). Tasks arrive from the user\'s panel (you get ' +
    'a nudge) or from chat — a substantial chat ask becomes a task YOU create before working it. ' +
    'One task in-progress at a time, oldest first; set it in-progress when you start, lay out ' +
    'its steps with set_task_steps (the checklist the user watches on the panel), and complete ' +
    'it the moment it is finished and verified. Before working any task, read the ' +
    '"task-planner" notebook — it carries the full discipline (pickup, clearance via ask_user, ' +
    'sizing, plan-then-steps). Never narrate the bookkeeping.',
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
    'and what was decided, in plain language — started a task, finished a task, a fix, a ' +
    'check that passed. When the work landed as a commit, pass its short hash as `commit`. ' +
    'Entries are attributed to your session automatically, so the journal reads as the ' +
    "workspace's timeline: who did what, when, and where to look. The journal is append-only " +
    'for you — write entries as a faithful record; never narrate the bookkeeping.',
].join('\n')

// Section order is stable (tasks → plans → phases → features → journal) so
// the composed prompt never reshuffles between turns. (The working-steps dock
// section rode here until 2026-08-24 — retired with set_todos in favour of
// the task panel's steps.)
const CAPABILITY_PROMPT_SECTIONS: readonly { capabilityId: string; section: string }[] = [
  { capabilityId: 'tasks', section: TASKS_PROMPT_INSTRUCTIONS },
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
// stays EMPTY (no vynel tool cards in EVERY mode — Chad's 2026-07-26 stance,
// re-affirmed by Kafi 2026-08-17 when run_background_process briefly joined);
// the ask-approval tier (`generatedAskModeApprovalToolNames` — DELETE routes +
// x-mcp.askApproval, run_background_process included) cards in ask mode only.
// IF a tool ever genuinely needs every-mode carding, a descriptor-only entry
// here is NOT enough: the policy layer's strip-then-re-add discards it unless
// the catalog's cardClass also says 'always' (the 2026-08-17 review catch —
// the composed-level test in compose-session-mcp-servers.test.ts pins the
// interplay).
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
  toolNames: WORKSPACE_TOOL_NAMES,
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
  toolNames: WORKSPACE_INTERACTIVE_TOOL_NAMES,
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
export const vynelRoutingDescriptor: McpFeatureDescriptor = {
  serverName: 'vynel',
  toolNames: ROUTING_TOOL_NAMES,
  build: (context) => buildGlobalRootMcpServer(toMcpScope(context), context.appRequest),
  mutatingToolNames: [],
  askModeApprovalToolNames: generatedAskModeApprovalToolNames,
  featureGatedTools: ROUTING_FEATURE_GATED_TOOLS,
}

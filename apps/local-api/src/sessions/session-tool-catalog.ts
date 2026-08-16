// The session tool catalog — ONE legible home for "which tool exists, on
// which surfaces, behind which gates, carding how". Two halves:
//
//   1. `SURFACE_DESCRIPTOR_SETS` — the declarative surface → server map the
//      admin matrix renders. The nine turn sites keep their own (conditional)
//      wiring — ssh needs a master key, study is per-turn, desktop is
//      target-dependent — so this map is the READ MODEL, drift-guarded by
//      session-tool-catalog.test.ts against what each site actually composes.
//   2. `buildSessionToolCatalog()` — the declared per-tool defaults
//      (ToolCatalogEntry[]) the effective-policy resolver merges overrides
//      into. Vynel entries derive from the generated registry via
//      `@vynel/mcp`'s gate module; the small fixed servers' inventories are
//      pinned by their own packages' tests.
//
// Duplicate-name pre-merge: several vynel tools ride more than one generated
// array under the same name — entries here merge surface membership per
// toolName (the resolver's documented precondition).

import {
  ALWAYS_CARD_TOOL_NAMES,
  ROUTING_FEATURE_GATED_TOOLS,
  ROUTING_TOOL_NAMES,
  VYNEL_CAPABILITY_GATED_TOOLS,
  VYNEL_FEATURE_GATED_TOOLS,
  WORKSPACE_INTERACTIVE_TOOL_NAMES,
  WORKSPACE_TOOL_NAMES,
  generatedAskModeApprovalToolNames,
} from '@vynel/mcp/tool-gates'
import type { Database } from '@vynel/db'
import {
  applyToolPolicyDefaultsToCatalog,
  resolveEffectiveToolPolicies,
  type EffectiveToolPolicies,
  type SessionSurfaceKind,
  type ToolCatalogEntry,
  type ToolCardClass,
} from '@vynel/capabilities'
import { bakedToolPolicyDefaults } from './baked-tool-policy-defaults.js'

/** The servers a surface kind composes (the read model; see file header). */
export const SURFACE_DESCRIPTOR_SETS: Readonly<Record<SessionSurfaceKind, readonly string[]>> = {
  'global-interactive': ['vynel', 'vynel-notebook', 'vynel-ask', 'desktop', 'vynel-ssh'],
  // vynel-ask rides channel turns BOUNDED (the ask slice): the Telegram
  // nudge exists, and a 10-min expiry keeps an unanswered form from parking
  // the background job forever.
  'global-channel': ['vynel', 'vynel-notebook', 'vynel-ask', 'desktop'],
  'workspace-interactive': ['vynel', 'vynel-notebook', 'vynel-ask', 'vynel-ssh'],
  'workspace-background': ['vynel', 'vynel-notebook'],
  // Desktop never composes here: DESKTOP_CAPABLE_DELEGATED_TARGETS is
  // {'spawned-session'}, and that target always reclassifies to 'spawned' /
  // 'delegated-global' — a workspace-root delegation is desktop-free.
  'delegated-workspace': ['vynel', 'vynel-notebook'],
  'delegated-global': ['vynel', 'vynel-notebook', 'desktop'],
  spawned: ['vynel', 'vynel-notebook', 'desktop'],
  agent: ['vynel', 'vynel-notebook'],
  schedule: ['vynel', 'vynel-notebook'],
}

// WHICH vynel variant each surface composes decides a vynel tool's surfaces.
const WORKSPACE_VARIANT_SURFACES: readonly SessionSurfaceKind[] = [
  'workspace-interactive',
  'workspace-background',
  'delegated-workspace',
  'spawned',
  'agent',
  'schedule',
]
const INTERACTIVE_EXTRA_SURFACES: readonly SessionSurfaceKind[] = [
  'workspace-interactive',
  'delegated-workspace',
  // A delegated spawned-session turn composes the INTERACTIVE variant (Chad
  // 2026-07-26: a spawned session keeps its parent's whole toolset — the
  // two-hop chains need it), so the spawning tools ride 'spawned' too.
  'spawned',
  'agent',
]
const ROUTING_SURFACES: readonly SessionSurfaceKind[] = [
  'global-interactive',
  'global-channel',
  'delegated-global',
]

function invertGateMap(
  map: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, string> {
  const byTool = new Map<string, string>()
  for (const [key, names] of Object.entries(map)) {
    for (const name of names) byTool.set(name, key)
  }
  return byTool
}

const VYNEL_FEATURE_BY_TOOL = invertGateMap(VYNEL_FEATURE_GATED_TOOLS)
const ROUTING_FEATURE_BY_TOOL = invertGateMap(ROUTING_FEATURE_GATED_TOOLS)
const VYNEL_CAPABILITY_BY_TOOL = invertGateMap(VYNEL_CAPABILITY_GATED_TOOLS)

// The curated ask tier (generated DELETE routes + x-mcp.askApproval, plus the
// desktop plan gate) — the behavior-neutral card defaults Chad locked.
const ASK_CARD_TOOL_NAMES = new Set<string>([
  ...generatedAskModeApprovalToolNames,
  'mcp__desktop__propose_desktop_plan',
])

type FixedServer = {
  serverName: string
  toolNames: readonly string[]
  surfaces: readonly SessionSurfaceKind[]
  featureKey?: string
}

// The small fixed servers — inventories pinned by their own packages' tests.
const FIXED_SERVERS: readonly FixedServer[] = [
  {
    serverName: 'vynel-notebook',
    toolNames: ['mcp__vynel-notebook__list_playbooks', 'mcp__vynel-notebook__read_playbook'],
    surfaces: Object.entries(SURFACE_DESCRIPTOR_SETS)
      .filter(([, servers]) => servers.includes('vynel-notebook'))
      .map(([kind]) => kind as SessionSurfaceKind),
  },
  {
    serverName: 'vynel-ask',
    toolNames: ['mcp__vynel-ask__ask_user'],
    surfaces: ['global-interactive', 'workspace-interactive', 'global-channel'],
  },
  {
    serverName: 'desktop',
    toolNames: [], // filled below from the descriptor's declared inventory
    surfaces: ['global-interactive', 'global-channel', 'delegated-global', 'spawned'],
  },
  {
    serverName: 'vynel-ssh',
    toolNames: ['mcp__vynel-ssh__list_ssh_servers', 'mcp__vynel-ssh__run_ssh_command'],
    surfaces: ['global-interactive', 'workspace-interactive'],
    featureKey: 'ssh',
  },
]

function vynelSurfacesFor(toolName: string): SessionSurfaceKind[] {
  const surfaces = new Set<SessionSurfaceKind>()
  if (WORKSPACE_TOOL_NAMES.includes(toolName)) {
    for (const kind of WORKSPACE_VARIANT_SURFACES) surfaces.add(kind)
  }
  if (
    WORKSPACE_INTERACTIVE_TOOL_NAMES.includes(toolName) &&
    !WORKSPACE_TOOL_NAMES.includes(toolName)
  ) {
    for (const kind of INTERACTIVE_EXTRA_SURFACES) surfaces.add(kind)
  }
  if (ROUTING_TOOL_NAMES.includes(toolName)) {
    for (const kind of ROUTING_SURFACES) surfaces.add(kind)
  }
  return [...surfaces]
}

// The every-mode tier first (shell-equivalent tools — ONE home with the vynel
// descriptors' mutatingToolNames, see vynel-tool-gates): the policy layer's
// strip-then-re-add makes THIS the value that actually cards a real turn.
const ALWAYS_CARD_SET = new Set<string>(ALWAYS_CARD_TOOL_NAMES)

function cardClassFor(toolName: string): ToolCardClass {
  if (ALWAYS_CARD_SET.has(toolName)) return 'always'
  return ASK_CARD_TOOL_NAMES.has(toolName) ? 'ask' : 'never'
}

/** Resolve the admin-merged policies for a turn. `desktopToolNames` comes
 *  from the caller because only desktop-composing sites import that (heavy)
 *  package — a site without desktop passes [] and its desktop policy entries
 *  are inert (the composer skips unregistered servers). */
export function resolveSessionToolPolicies(
  db: Database,
  input: { userId: string; desktopToolNames?: readonly string[] },
): EffectiveToolPolicies {
  // Three layers: code catalog → baked operator map (boot-primed, empty in
  // dev) → this user's override rows inside the resolver.
  return resolveEffectiveToolPolicies(db, {
    userId: input.userId,
    catalog: applyToolPolicyDefaultsToCatalog(
      buildSessionToolCatalog({ desktopToolNames: input.desktopToolNames ?? [] }),
      bakedToolPolicyDefaults(),
    ),
  })
}

/** Assemble the declared defaults for every tool — one entry per toolName
 *  (duplicate-name surface membership pre-merged). Pure + cheap; callers may
 *  invoke per request. */
export function buildSessionToolCatalog(input: {
  desktopToolNames: readonly string[]
}): ToolCatalogEntry[] {
  const entries: ToolCatalogEntry[] = []

  const vynelNames = new Set<string>([
    ...WORKSPACE_TOOL_NAMES,
    ...WORKSPACE_INTERACTIVE_TOOL_NAMES,
    ...ROUTING_TOOL_NAMES,
  ])
  for (const toolName of vynelNames) {
    const featureKey = VYNEL_FEATURE_BY_TOOL.get(toolName) ?? ROUTING_FEATURE_BY_TOOL.get(toolName)
    const capabilityId = VYNEL_CAPABILITY_BY_TOOL.get(toolName)
    entries.push({
      toolName,
      serverName: 'vynel',
      surfaces: vynelSurfacesFor(toolName),
      cardClass: cardClassFor(toolName),
      ...(featureKey !== undefined ? { featureKey } : {}),
      ...(capabilityId !== undefined ? { capabilityId } : {}),
    })
  }

  for (const server of FIXED_SERVERS) {
    const toolNames = server.serverName === 'desktop' ? input.desktopToolNames : server.toolNames
    for (const toolName of toolNames) {
      // The notebook's two tools are capability-gated by 'notebook'.
      const capabilityId = server.serverName === 'vynel-notebook' ? 'notebook' : undefined
      entries.push({
        toolName,
        serverName: server.serverName,
        surfaces: server.surfaces,
        cardClass: cardClassFor(toolName),
        ...(server.featureKey !== undefined ? { featureKey: server.featureKey } : {}),
        ...(capabilityId !== undefined ? { capabilityId } : {}),
      })
    }
  }
  return entries
}

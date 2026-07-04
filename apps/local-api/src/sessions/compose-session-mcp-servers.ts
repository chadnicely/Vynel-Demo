// `composeSessionMcpServers` — assembles a turn's MCP attachment from a list of
// feature descriptors. The per-turn sibling of `composeSessionCapabilities`:
// every turn entry-point calls it ONCE instead of hand-assembling the
// `mcpServers` record + allow/deny patterns + per-feature prompt inline. That
// inline assembly is exactly how a feature got wired into one turn type and
// silently missing from another (desktop on the web root but not the channel
// root) — a single composition step makes feature inclusion an explicit per-turn
// choice (the descriptor LIST the caller passes) and closes that divergence class.
//
// Lives at apps/local-api (NOT a package) — the locked `api-side-turn-execution-
// with-mcp` decision keeps core below the MCP producers. Callers dynamically
// import the descriptors (deferring the heavy SDK) and pass them here; this
// module imports only the descriptor TYPE (type-only, no runtime).
//
// Per-turn-type descriptor lists:
//   - workspace turn  → [vynelWorkspaceDescriptor]   (full tools, capability-gated)
//   - global-root turn → [vynelRoutingDescriptor, ...]

import type { McpFeatureDescriptor, SessionToolContext } from '@vynel/mcp-contract'

export interface ComposedSessionMcpServers {
  // Server key → built in-process server, for the SDK's `options.mcpServers`.
  // `unknown` keeps the SDK type out of the api turn layer (the provider casts at
  // the edge, per the chat contract's `Record<string, unknown>` precedent).
  mcpServers: Record<string, unknown>
  // `mcp__<serverName>__*` for each included feature.
  allowedMcpToolPatterns: string[]
  // Tools denied because their gating capability is disabled (an `alwaysOn` core
  // feature is never denied).
  deniedMcpToolPatterns: string[]
  // Union of every included feature's mutating tools (an `alwaysOn` feature
  // contributes none) — fed into the approval backstop additively.
  mutatingToolNames: string[]
  // Concatenated self-contained feature prompts. The turn's own base prompt +
  // operating-rules/memory stay with their owners.
  systemPromptAppend: string
}

export function composeSessionMcpServers(
  descriptors: readonly McpFeatureDescriptor[],
  context: SessionToolContext,
  options: { enabledCapabilityIds?: ReadonlySet<string> } = {},
): ComposedSessionMcpServers {
  const enabledCapabilityIds = options.enabledCapabilityIds ?? new Set<string>()
  const mcpServers: Record<string, unknown> = {}
  const allowedMcpToolPatterns: string[] = []
  const deniedMcpToolPatterns: string[] = []
  const mutatingToolNames: string[] = []
  const promptSections: string[] = []

  for (const descriptor of descriptors) {
    // Cheap pre-check, then build; either path can exclude the feature.
    if (descriptor.isApplicable?.(context) === false) continue
    const server = descriptor.build(context)
    if (server === null) continue

    mcpServers[descriptor.serverName] = server
    const allowPattern = `mcp__${descriptor.serverName}__*`
    if (!allowedMcpToolPatterns.includes(allowPattern)) allowedMcpToolPatterns.push(allowPattern)

    // A core-tier (`alwaysOn`) feature is always-on + no-approval: never
    // capability-denied, never carded — regardless of permission mode.
    if (descriptor.alwaysOn !== true) {
      mutatingToolNames.push(...descriptor.mutatingToolNames)
      if (descriptor.capabilityGatedTools !== undefined) {
        for (const [capabilityId, toolNames] of Object.entries(descriptor.capabilityGatedTools)) {
          if (!enabledCapabilityIds.has(capabilityId)) deniedMcpToolPatterns.push(...toolNames)
        }
      }
    }

    const contribution = descriptor.contributePrompt?.(context)
    if (contribution !== undefined && contribution !== null && contribution !== '') {
      promptSections.push(contribution)
    }
  }

  return {
    mcpServers,
    allowedMcpToolPatterns,
    deniedMcpToolPatterns,
    mutatingToolNames,
    systemPromptAppend: promptSections.join('\n\n'),
  }
}

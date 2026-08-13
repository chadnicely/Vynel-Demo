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
  // Deliberately NO `mcp__<serverName>__*` allow patterns: a bare allowedTools
  // entry auto-approves the whole server upstream of `canUseTool`
  // (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), which silently un-gated every MCP tool
  // in ask mode. Registration alone is what offers the tools; the provider's
  // policy map decides allow-vs-card per call.
  mcpServers: Record<string, unknown>
  // Tools denied because their gating capability is disabled (an `alwaysOn` core
  // feature is never denied).
  deniedMcpToolPatterns: string[]
  // Union of every included feature's mutating tools (an `alwaysOn` feature
  // contributes none) — fed into the approval backstop additively.
  mutatingToolNames: string[]
  // Union of every included feature's destructive tier — cards ONLY in ask mode
  // (an `alwaysOn` feature contributes none here either).
  askModeApprovalToolNames: string[]
  // Concatenated self-contained feature prompts. The turn's own base prompt +
  // operating-rules/memory stay with their owners.
  systemPromptAppend: string
}

export function composeSessionMcpServers(
  descriptors: readonly McpFeatureDescriptor[],
  context: SessionToolContext,
  options: {
    enabledCapabilityIds?: ReadonlySet<string>
    /** The hub entitlement's feature keys. `undefined` = NO live entitlement
     *  (hub not configured / signed out / offline past grace) — deliberately
     *  FAIL-OPEN, matching the HTTP featureGate's posture: the gate enforces
     *  only what a live entitlement actually says. A set filters strictly.
     *  (Capabilities differ on purpose: absent set = default-deny — a
     *  capability read always exists; an entitlement may genuinely not.) */
    enabledFeatureKeys?: ReadonlySet<string>
  } = {},
): ComposedSessionMcpServers {
  const enabledCapabilityIds = options.enabledCapabilityIds ?? new Set<string>()
  const mcpServers: Record<string, unknown> = {}
  const deniedMcpToolPatterns: string[] = []
  const mutatingToolNames: string[] = []
  const askModeApprovalToolNames: string[] = []
  const promptSections: string[] = []

  for (const descriptor of descriptors) {
    // Cheap pre-check, then build; either path can exclude the feature.
    if (descriptor.isApplicable?.(context) === false) continue
    const server = descriptor.build(context)
    if (server === null) continue

    mcpServers[descriptor.serverName] = server

    // A core-tier (`alwaysOn`) feature is always-on + no-approval: never
    // capability-denied, never carded — regardless of permission mode.
    let everyGatedToolDenied = false
    let everyFeatureGateDenied = false
    if (descriptor.alwaysOn !== true) {
      mutatingToolNames.push(...descriptor.mutatingToolNames)
      for (const toolName of descriptor.askModeApprovalToolNames ?? []) {
        // The vynel descriptors share one generated set, so a two-descriptor
        // turn would double every name without the guard.
        if (!askModeApprovalToolNames.includes(toolName)) askModeApprovalToolNames.push(toolName)
      }
      if (descriptor.capabilityGatedTools !== undefined) {
        const gateEntries = Object.entries(descriptor.capabilityGatedTools)
        const deniedGateEntries = gateEntries.filter(
          ([capabilityId]) => !enabledCapabilityIds.has(capabilityId),
        )
        for (const [, toolNames] of deniedGateEntries) deniedMcpToolPatterns.push(...toolNames)
        everyGatedToolDenied = gateEntries.length > 0 && deniedGateEntries.length === gateEntries.length
      }
      // The tier gate — same three lines as the capability gate, but only
      // against a LIVE entitlement (undefined = fail-open, see the option doc).
      if (descriptor.featureGatedTools !== undefined && options.enabledFeatureKeys !== undefined) {
        const enabledFeatureKeys = options.enabledFeatureKeys
        const featureEntries = Object.entries(descriptor.featureGatedTools)
        const deniedFeatureEntries = featureEntries.filter(
          ([featureKey]) => !enabledFeatureKeys.has(featureKey),
        )
        for (const [, toolNames] of deniedFeatureEntries) deniedMcpToolPatterns.push(...toolNames)
        everyFeatureGateDenied =
          featureEntries.length > 0 && deniedFeatureEntries.length === featureEntries.length
      }
    }

    // A fully capability-denied feature contributes NO prompt: the notebook is
    // the first descriptor combining capabilityGatedTools + contributePrompt,
    // and with its capability toggled OFF the turn would still say "call
    // list_playbooks…" while every one of those tools is denied — the model
    // gets steered into calls that can only fail. The tier twin applies the
    // same rule to a descriptor gated ONLY by tier (ssh: every tool behind one
    // key); a descriptor that also has capability gates keeps its prompt —
    // its capability-gated sections may still be live.
    if (everyGatedToolDenied) continue
    if (everyFeatureGateDenied && descriptor.capabilityGatedTools === undefined) continue
    const contribution = descriptor.contributePrompt?.(context, enabledCapabilityIds)
    if (contribution !== undefined && contribution !== null && contribution !== '') {
      promptSections.push(contribution)
    }
  }

  return {
    mcpServers,
    deniedMcpToolPatterns,
    mutatingToolNames,
    askModeApprovalToolNames,
    systemPromptAppend: promptSections.join('\n\n'),
  }
}

/** Merge two composed attachments (chat-mentions: the spawned-thread stream
 *  composes its background set through the SHARED composer — which hides the
 *  descriptor list — and the per-turn study descriptor separately). Server
 *  names must not collide; the study server's name is unique by construction. */
export function mergeComposedSessionMcpServers(
  base: ComposedSessionMcpServers,
  extra: ComposedSessionMcpServers,
): ComposedSessionMcpServers {
  return {
    mcpServers: { ...base.mcpServers, ...extra.mcpServers },
    deniedMcpToolPatterns: [...base.deniedMcpToolPatterns, ...extra.deniedMcpToolPatterns],
    mutatingToolNames: [...base.mutatingToolNames, ...extra.mutatingToolNames],
    askModeApprovalToolNames: [
      ...base.askModeApprovalToolNames,
      ...extra.askModeApprovalToolNames,
    ],
    systemPromptAppend: [base.systemPromptAppend, extra.systemPromptAppend]
      .filter((section) => section !== '')
      .join('\n\n'),
  }
}

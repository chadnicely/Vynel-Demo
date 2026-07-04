// `composeSessionCapabilities` — assembles the agent's per-turn PROMPT
// contribution from the workspace's enabled capabilities: the always-on Vynel
// operating-rules plus, per enabled capability, its system-prompt contribution
// (memory's snapshot + instruction today; knowledge in Phase B). The MCP-tool
// GATING (denying a disabled capability's tools) moved to composeSessionMcpServers
// in the C4 build — it reads each feature descriptor's capabilityGatedTools, so the
// tool grant lives with the tools. Reused by the workspace turn entry-points
// (chat / schedules). Sync (Phase 1 DB reads).

import type { Database } from '@vynel/db'
import { listEnabledCapabilities, type CapabilityId } from '@vynel/capabilities'
import { buildMemorySessionContribution } from '@vynel/memory'
import { VYNEL_AGENT_INSTRUCTIONS } from './vynel-agent-instructions.js'

export type ComposedSessionCapabilities = {
  systemPromptAppend: string
}

export function composeSessionCapabilities(
  db: Database,
  input: { workspaceId: string },
): ComposedSessionCapabilities {
  const enabled = listEnabledCapabilities(db, input.workspaceId)
  const enabledIds = new Set<CapabilityId>(enabled.map((capability) => capability.id))

  const sections: string[] = [VYNEL_AGENT_INSTRUCTIONS]
  if (enabledIds.has('memory')) {
    sections.push(buildMemorySessionContribution(db, { workspaceId: input.workspaceId }))
  }
  // Knowledge contribution joins in Phase B.

  return {
    systemPromptAppend: sections.join('\n\n'),
  }
}

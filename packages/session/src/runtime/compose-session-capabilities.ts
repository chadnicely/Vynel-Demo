// `composeSessionCapabilities` — assembles the agent's per-turn PROMPT
// contribution from the workspace's enabled capabilities: the always-on Vynel
// identity stack (`base` + `workspace-manager` — editable markdown composed by
// `@vynel/instructions/session-instructions`) plus, per enabled capability, its
// system-prompt contribution (memory's snapshot today; knowledge in Phase B).
// The MCP-tool
// GATING (denying a disabled capability's tools) moved to composeSessionMcpServers
// in the C4 build — it reads each feature descriptor's capabilityGatedTools, so the
// tool grant lives with the tools. Reused by the workspace turn entry-points
// (chat / schedules). Sync (Phase 1 DB reads).

import type { Database } from '@vynel/db'
import { listEnabledCapabilities, type CapabilityId } from '@vynel/capabilities'
import { buildMemorySessionContribution } from '@vynel/memory'
import { composeSessionInstruction } from '@vynel/instructions/session-instructions'

export type ComposedSessionCapabilities = {
  systemPromptAppend: string
}

export function composeSessionCapabilities(
  db: Database,
  input: { workspaceId: string; workspaceName: string },
): ComposedSessionCapabilities {
  const enabled = listEnabledCapabilities(db, input.workspaceId)
  const enabledIds = new Set<CapabilityId>(enabled.map((capability) => capability.id))

  const sections: string[] = [
    composeSessionInstruction('workspace-manager', { workspaceName: input.workspaceName }),
  ]
  if (enabledIds.has('memory')) {
    sections.push(buildMemorySessionContribution(db, { workspaceId: input.workspaceId }))
  }
  // Knowledge contribution joins in Phase B.

  return {
    systemPromptAppend: sections.join('\n\n'),
  }
}

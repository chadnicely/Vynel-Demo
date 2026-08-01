// Removes one standalone MCP server entry from a scope's Claude config —
// the marketplace `mcp` kind's whole uninstall (config-is-truth twin of
// `install-mcp-server-for-scope.ts`). Removing a name that isn't present
// is a silent no-op, matching the writer's delete semantics.

import type { SkillScope } from '../repositories/index.js'
import { updateMcpServersForScope } from '../internal/update-mcp-servers-for-scope.js'

export type RemoveMcpServerForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  serverName: string
}

export async function removeMcpServerForScope(
  input: RemoveMcpServerForScopeInput,
): Promise<void> {
  const writeInput: Parameters<typeof updateMcpServersForScope>[0] = {
    scope: input.scope,
    serversToAdd: [],
    serversToRemove: [input.serverName],
  }
  if (input.workspacePath !== undefined) writeInput.workspacePath = input.workspacePath
  await updateMcpServersForScope(writeInput)
}

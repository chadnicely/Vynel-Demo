// Removes one standalone MCP server entry from a scope's Claude config —
// the config-is-truth twin of `install-mcp-server-for-scope.ts`. Removing
// a name that isn't present is a silent no-op, matching the writer's
// delete semantics.
//
// A marketplace uninstall passes `onlyIfProvenanceItemId`: an unmarked or
// other-marked entry is never deleted (it is the user's hand-made entry,
// or another item's) — that refusal surfaces as a ConflictError because
// the annotator only matches marked entries, so reaching it means the
// config drifted between annotate and remove. The user-driven mcp-servers
// routes pass no marker requirement: the user removes from a list they
// can see, whatever the entry's origin.

import { ConflictError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import { updateMcpServersForScope } from '../internal/update-mcp-servers-for-scope.js'

export type RemoveMcpServerForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  serverName: string
  onlyIfProvenanceItemId?: string
}

export async function removeMcpServerForScope(
  input: RemoveMcpServerForScopeInput,
): Promise<void> {
  const writeInput: Parameters<typeof updateMcpServersForScope>[0] = {
    scope: input.scope,
    serversToAdd: [],
    serversToRemove: [
      input.onlyIfProvenanceItemId !== undefined
        ? { serverName: input.serverName, onlyIfProvenanceItemId: input.onlyIfProvenanceItemId }
        : { serverName: input.serverName },
    ],
  }
  if (input.workspacePath !== undefined) writeInput.workspacePath = input.workspacePath
  const outcome = await updateMcpServersForScope(writeInput)
  if (outcome.refusedRemovalServerNames.includes(input.serverName)) {
    throw new ConflictError(
      `The MCP server '${input.serverName}' in this scope's config was not installed by this ` +
        `marketplace item — refusing to remove it. Manage it from the MCP servers list instead.`,
    )
  }
}

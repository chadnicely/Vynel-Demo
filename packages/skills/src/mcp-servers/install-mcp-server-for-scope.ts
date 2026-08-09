// Installs one STANDALONE MCP server into a scope's Claude config —
// the marketplace `mcp` kind's whole install (config-is-truth, Chad
// 2026-08-02): the entry in `~/.claude.json` mcpServers (user scope) or
// `<workspacePath>/.mcp.json` (workspace scope) IS the installed state;
// no DB row exists. Lives in the skills leaf because coding.md §1.2
// makes this leaf the ONLY filesystem writer of those config files —
// the shared `updateMcpServersForScope` internal does the write.
//
// A marketplace install passes `provenance` and is idempotent ONLY over
// its own entry: re-installing the same item overwrites (repair), but a
// hand-added or other-item entry holding the name is never clobbered —
// that ConflictError is the install-side half of the provenance guard
// (the uninstall half lives in `remove-mcp-server-for-scope.ts`). A
// provenance-less call (the custom-add path) keeps plain write-through;
// its duplicate check lives in `add-custom-mcp-server-for-scope.ts`.

import { ConflictError } from '@vynel/errors'
import type { SkillScope } from '../repositories/index.js'
import type { SkillRequiredMcpServer } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { updateMcpServersForScope } from '../internal/update-mcp-servers-for-scope.js'
import type { McpServerProvenance } from '../internal/mcp-server-provenance.js'

export type InstallMcpServerForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  server: SkillRequiredMcpServer
  provenance?: McpServerProvenance
}

export async function installMcpServerForScope(
  input: InstallMcpServerForScopeInput,
): Promise<void> {
  const writeInput: Parameters<typeof updateMcpServersForScope>[0] = {
    scope: input.scope,
    serversToAdd: [
      input.provenance !== undefined
        ? { server: input.server, provenance: input.provenance }
        : { server: input.server },
    ],
    serversToRemove: [],
  }
  if (input.workspacePath !== undefined) writeInput.workspacePath = input.workspacePath
  const outcome = await updateMcpServersForScope(writeInput)
  if (outcome.refusedAdditionServerNames.includes(input.server.serverName)) {
    throw new ConflictError(
      `An MCP server named '${input.server.serverName}' already exists in this scope's config ` +
        `and was not installed by this item — remove it first if you want the marketplace version.`,
    )
  }
}

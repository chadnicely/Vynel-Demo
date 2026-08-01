// Installs one STANDALONE MCP server into a scope's Claude config —
// the marketplace `mcp` kind's whole install (config-is-truth, Chad
// 2026-08-02): the entry in `~/.claude.json` mcpServers (user scope) or
// `<workspacePath>/.mcp.json` (workspace scope) IS the installed state;
// no DB row exists. Lives in the skills leaf because coding.md §1.2
// makes this leaf the ONLY filesystem writer of those config files —
// the shared `updateMcpServersForScope` internal does the write.
//
// Re-installing an already-present serverName overwrites its entry
// (idempotent repair — same posture as the cloud-skill update).

import type { SkillScope } from '../repositories/index.js'
import type { SkillRequiredMcpServer } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { updateMcpServersForScope } from '../internal/update-mcp-servers-for-scope.js'

export type InstallMcpServerForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  server: SkillRequiredMcpServer
}

export async function installMcpServerForScope(
  input: InstallMcpServerForScopeInput,
): Promise<void> {
  const writeInput: Parameters<typeof updateMcpServersForScope>[0] = {
    scope: input.scope,
    serversToAdd: [input.server],
    serversToRemove: [],
  }
  if (input.workspacePath !== undefined) writeInput.workspacePath = input.workspacePath
  await updateMcpServersForScope(writeInput)
}

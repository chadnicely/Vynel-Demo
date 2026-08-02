// Adds one USER-AUTHORED MCP server to a scope's Claude config — the "Add
// custom server" form's core op. Unlike the marketplace install (idempotent
// overwrite for repair), a custom add REFUSES a name that already exists in
// the target scope (ConflictError): silently clobbering a marketplace-
// installed or hand-edited entry from a form typo would be data loss.
//
// Remote URL policy: https only — plaintext http would ship the auth headers
// unencrypted. Exact loopback hosts (localhost / 127.0.0.1 / ::1) are exempt:
// a local dev server never leaves the machine. Header/env VALUES pass through to the
// config file (the accepted design) and must never be logged or echoed.

import { ConflictError, ValidationError } from '@vynel/errors'
import type { SkillRequiredMcpServer } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { SkillScope } from '../repositories/index.js'
import { installMcpServerForScope } from './install-mcp-server-for-scope.js'
import { listMcpServerNamesForScope } from './list-mcp-server-names-for-scope.js'

export type AddCustomMcpServerForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  server: SkillRequiredMcpServer
}

export async function addCustomMcpServerForScope(
  input: AddCustomMcpServerForScopeInput,
): Promise<void> {
  const serverName = input.server.serverName.trim()
  if (serverName.length === 0) {
    throw new ValidationError('The MCP server needs a name — pick a short identifier.')
  }
  if (input.server.transport !== 'stdio') {
    assertAllowedRemoteUrl(input.server.url)
  }
  const existingNames = listMcpServerNamesForScope(input.scope, input.workspacePath)
  if (existingNames.includes(serverName)) {
    throw new ConflictError(
      `An MCP server named '${serverName}' already exists at this scope — ` +
        'remove it first, or pick another name.',
    )
  }

  const writeInput: Parameters<typeof installMcpServerForScope>[0] = {
    scope: input.scope,
    server: { ...input.server, serverName },
  }
  if (input.workspacePath !== undefined) writeInput.workspacePath = input.workspacePath
  await installMcpServerForScope(writeInput)
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function assertAllowedRemoteUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ValidationError(
      'The server URL is not a valid URL — it should look like https://example.com/mcp.',
    )
  }
  if (parsed.protocol === 'https:') return
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return
  throw new ValidationError(
    'Remote MCP servers must use https (plain http would send your auth headers ' +
      'unencrypted) — http is allowed only for localhost.',
  )
}

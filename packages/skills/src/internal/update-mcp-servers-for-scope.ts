// Updates the MCP config file (`~/.claude.json` or workspace
// `.mcp.json`) for a skill scope — touches ONLY the `mcpServers`
// field. The user's hand-edited other keys (theme settings, env
// vars, custom config) are preserved.
//
// Vynel-managed additions carry a provenance marker inside the entry
// (`mcp-server-provenance.ts`); hand-added entries never do. The marker
// is the data-loss guard in BOTH directions: a provenance-carrying
// addition refuses to overwrite a foreign entry, and a marker-required
// removal refuses to delete one. Refusals are reported, not thrown —
// each caller decides what a refusal means for its operation.
//
// Per coding.md §1.2 (this leaf is the only filesystem writer for
// `.claude/skills/` + `.claude.json` + `.mcp.json` + the workspace
// `settings.local.json`). Two writer files share that license: this one
// and its consent sibling `update-project-mcp-approval.ts` (folder trust
// + mcpjson approval). Code-reviewer enforces by grep.

import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { SkillScope } from '../repositories/index.js'
import type { SkillRequiredMcpServer } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { resolveMcpConfigPath } from './resolve-mcp-config-path.js'
import {
  MCP_SERVER_PROVENANCE_KEY,
  readMcpServerProvenanceItemId,
  type McpServerProvenance,
} from './mcp-server-provenance.js'
import {
  approveProjectMcpjsonServer,
  revokeProjectMcpjsonServerApproval,
} from './update-project-mcp-approval.js'

export type McpServerAddition = {
  server: SkillRequiredMcpServer
  /** Present for Vynel-managed installs (marketplace mcp items, a skill's
   * required servers); absent for the user's hand-added entries. */
  provenance?: McpServerProvenance
}

export type McpServerRemoval = {
  serverName: string
  /** When set, only an entry marked with this itemId is removed — an
   * unmarked or other-marked entry survives (it is not ours to delete). */
  onlyIfProvenanceItemId?: string
}

export type UpdateMcpServersForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  serversToAdd: readonly McpServerAddition[]
  serversToRemove: readonly McpServerRemoval[]
}

export type UpdateMcpServersOutcome = {
  removedServerNames: string[]
  /** Marker-required removals whose entry was unmarked or other-marked. */
  refusedRemovalServerNames: string[]
  /** Provenance-carrying additions whose name is held by a foreign entry. */
  refusedAdditionServerNames: string[]
}

export async function updateMcpServersForScope(
  input: UpdateMcpServersForScopeInput,
): Promise<UpdateMcpServersOutcome> {
  const configPath = resolveMcpConfigPath(input.scope, input.workspacePath)
  await mkdir(path.dirname(configPath), { recursive: true })

  const existingConfig = await readMcpConfigOrEmpty(configPath)
  const existingServers: Record<string, unknown> =
    typeof existingConfig.mcpServers === 'object' && existingConfig.mcpServers !== null
      ? { ...(existingConfig.mcpServers as Record<string, unknown>) }
      : {}

  const outcome: UpdateMcpServersOutcome = {
    removedServerNames: [],
    refusedRemovalServerNames: [],
    refusedAdditionServerNames: [],
  }

  for (const removal of input.serversToRemove) {
    const existing = existingServers[removal.serverName]
    if (existing === undefined) continue
    if (
      removal.onlyIfProvenanceItemId !== undefined &&
      readMcpServerProvenanceItemId(existing) !== removal.onlyIfProvenanceItemId
    ) {
      outcome.refusedRemovalServerNames.push(removal.serverName)
      continue
    }
    delete existingServers[removal.serverName]
    outcome.removedServerNames.push(removal.serverName)
  }

  const appliedAdditionNames: string[] = []
  for (const addition of input.serversToAdd) {
    const existing = existingServers[addition.server.serverName]
    if (
      addition.provenance !== undefined &&
      existing !== undefined &&
      readMcpServerProvenanceItemId(existing) !== addition.provenance.itemId
    ) {
      outcome.refusedAdditionServerNames.push(addition.server.serverName)
      continue
    }
    existingServers[addition.server.serverName] = toClaudeMcpServerEntry(
      addition.server,
      addition.provenance,
    )
    appliedAdditionNames.push(addition.server.serverName)
  }

  // A fully-refused (or no-op) update never rewrites the file — the refusal
  // paths promise "we don't touch what isn't ours", and a rewrite would
  // still normalize the user's hand-formatted JSON.
  if (outcome.removedServerNames.length === 0 && appliedAdditionNames.length === 0) {
    return outcome
  }

  const newConfig = { ...existingConfig, mcpServers: existingServers }
  await writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8')

  // Workspace `.mcp.json` servers stay UNTRUSTED to Claude Code until
  // per-project approval lands in `~/.claude.json` — and every workspace
  // entry written here is consent-backed (carded install / add form /
  // carded skill install), so the approval rides the same write. Removal
  // revokes it, keeping the trust record as tidy as the config.
  if (input.scope === 'workspace' && input.workspacePath !== undefined) {
    for (const serverName of appliedAdditionNames) {
      await approveProjectMcpjsonServer(input.workspacePath, serverName)
    }
    for (const serverName of outcome.removedServerNames) {
      await revokeProjectMcpjsonServerApproval(input.workspacePath, serverName)
    }
  }
  return outcome
}

// The exact shapes Claude Code reads (SDK `McpStdioServerConfig` /
// `McpHttpServerConfig` / `McpSSEServerConfig`), keyed by `type`. The
// explicit `type: 'stdio'` is optional per the SDK but written anyway —
// self-documenting, and it keeps the reader's discrimination symmetric.
// Remote entries carry NO command/args/env; empty headers are omitted
// rather than written as `headers: {}`.
function toClaudeMcpServerEntry(
  server: SkillRequiredMcpServer,
  provenance: McpServerProvenance | undefined,
): Record<string, unknown> {
  const provenanceField =
    provenance !== undefined ? { [MCP_SERVER_PROVENANCE_KEY]: provenance } : {}
  if (server.transport === 'stdio') {
    return {
      type: 'stdio',
      command: server.commandOrUrl,
      args: server.args,
      env: server.environment,
      ...provenanceField,
    }
  }
  return {
    type: server.transport,
    url: server.url,
    ...(server.headers !== undefined && Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {}),
    ...provenanceField,
  }
}

type McpConfigShape = {
  mcpServers?: unknown
  [otherKey: string]: unknown
}

async function readMcpConfigOrEmpty(configPath: string): Promise<McpConfigShape> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err) {
    // Only the "file does not exist" case is safe to treat as empty —
    // we're about to write a fresh config. Permission failures or any
    // other read error MUST surface so the user can see them before we
    // overwrite something we couldn't actually inspect.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }

  // File exists. Malformed JSON is the user's mid-edit OR a third-party
  // corruption — clobbering would destroy the user's hand-edited keys
  // the file-header promises to preserve. Throw a typed error so the
  // caller surfaces it; a fresh write here would silently overwrite the
  // user's `~/.claude.json` data. Code-reviewer C2 (2026-05-25).
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (err) {
    throw new Error(
      `MCP config at ${configPath} is malformed JSON and cannot be safely updated; ` +
        `the file must be repaired or removed before re-running the install. ` +
        `Underlying parse error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      `MCP config at ${configPath} is JSON but not an object (was ${typeof parsed}); ` +
        `the file must be repaired or removed before re-running the install.`,
    )
  }
  return parsed as McpConfigShape
}

// Updates the MCP config file (`~/.claude.json` or workspace
// `.mcp.json`) for a skill scope — touches ONLY the `mcpServers`
// field. The user's hand-edited other keys (theme settings, env
// vars, custom config) are preserved.
//
// Each entry in `serversToAdd` is converted from the catalog's
// `SkillRequiredMcpServer` shape into Claude Code's native
// `mcpServers` entry. `serversToRemove` is a list of server
// names (string) keyed off the same shape.
//
// Per coding.md §1.2 (the installer is the only filesystem
// writer for `.claude/skills/` + `.claude.json` + `.mcp.json`).
// Code-reviewer enforces by grep — no other code writes these
// paths.

import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { SkillScope } from '../repositories/index.js'
import type { SkillRequiredMcpServer } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { resolveMcpConfigPath } from './resolve-mcp-config-path.js'

export type UpdateMcpServersForScopeInput = {
  scope: SkillScope
  workspacePath?: string
  serversToAdd: readonly SkillRequiredMcpServer[]
  serversToRemove: readonly string[] // server names
}

export async function updateMcpServersForScope(
  input: UpdateMcpServersForScopeInput,
): Promise<void> {
  const configPath = resolveMcpConfigPath(input.scope, input.workspacePath)
  await mkdir(path.dirname(configPath), { recursive: true })

  const existingConfig = await readMcpConfigOrEmpty(configPath)
  const existingServers: Record<string, unknown> =
    typeof existingConfig.mcpServers === 'object' && existingConfig.mcpServers !== null
      ? { ...(existingConfig.mcpServers as Record<string, unknown>) }
      : {}

  for (const name of input.serversToRemove) {
    delete existingServers[name]
  }

  for (const server of input.serversToAdd) {
    existingServers[server.serverName] = {
      command: server.commandOrUrl,
      args: server.args,
      env: server.environment,
      transport: server.transport,
    }
  }

  const newConfig = { ...existingConfig, mcpServers: existingServers }
  await writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8')
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

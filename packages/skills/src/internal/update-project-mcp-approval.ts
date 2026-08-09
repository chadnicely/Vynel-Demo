// Claude Code treats a project's `.mcp.json` servers as UNTRUSTED until the
// user approves them per project — recorded in `~/.claude.json` under
// `projects[<path>].enabledMcpjsonServers` (probed live 2026-08-09: login
// refuses with "awaiting approval" until the name appears there). Every
// workspace-scope entry Vynel writes is consent-backed (the carded
// marketplace install, the add-server form, a skill's carded install), so
// recording the approval belongs to the same single writer that writes the
// entry — without it, workspace servers can never sign in or connect.
//
// The real-world config keys the SAME directory under several spellings
// (drive-letter case, slash direction) — approval updates EVERY entry that
// normalizes to the workspace, and creates the native-form entry when none
// exists. Same protective posture as the mcp-config writer: other keys are
// preserved verbatim; malformed JSON throws rather than clobbering.

import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { resolveMcpConfigPath } from './resolve-mcp-config-path.js'

function normalizeProjectPath(value: string): string {
  return path.normalize(value).replace(/[\\/]+$/, '').toLowerCase()
}

export async function approveProjectMcpjsonServer(
  workspacePath: string,
  serverName: string,
): Promise<void> {
  await updateProjectApproval(workspacePath, serverName, 'approve')
}

export async function revokeProjectMcpjsonServerApproval(
  workspacePath: string,
  serverName: string,
): Promise<void> {
  await updateProjectApproval(workspacePath, serverName, 'revoke')
}

async function updateProjectApproval(
  workspacePath: string,
  serverName: string,
  action: 'approve' | 'revoke',
): Promise<void> {
  const configPath = resolveMcpConfigPath('user')
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    raw = '{}'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Claude config at ${configPath} is malformed JSON and cannot be safely updated; ` +
        `repair or remove it before retrying. Underlying parse error: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Claude config at ${configPath} is JSON but not an object.`)
  }
  const config = parsed as Record<string, unknown>
  const projects =
    typeof config.projects === 'object' && config.projects !== null
      ? { ...(config.projects as Record<string, unknown>) }
      : {}

  const normalizedTarget = normalizeProjectPath(workspacePath)
  const matchingKeys = Object.keys(projects).filter(
    (key) => normalizeProjectPath(key) === normalizedTarget,
  )
  if (matchingKeys.length === 0 && action === 'approve') {
    matchingKeys.push(workspacePath)
  }
  for (const key of matchingKeys) {
    const entry =
      typeof projects[key] === 'object' && projects[key] !== null
        ? { ...(projects[key] as Record<string, unknown>) }
        : {}
    const enabled = asStringArray(entry.enabledMcpjsonServers)
    const disabled = asStringArray(entry.disabledMcpjsonServers)
    if (action === 'approve') {
      entry.enabledMcpjsonServers = enabled.includes(serverName)
        ? enabled
        : [...enabled, serverName]
      // An earlier in-CLI rejection must not outrank the user's explicit
      // consent in Vynel's own flow.
      entry.disabledMcpjsonServers = disabled.filter((name) => name !== serverName)
    } else {
      entry.enabledMcpjsonServers = enabled.filter((name) => name !== serverName)
    }
    projects[key] = entry
  }
  await writeFile(
    configPath,
    JSON.stringify({ ...config, projects }, null, 2),
    'utf8',
  )
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

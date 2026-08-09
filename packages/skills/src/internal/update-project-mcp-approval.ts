// Claude Code gates a project's `.mcp.json` servers behind TWO consent
// records (probed live against 2.1.213, 2026-08-09, one wall at a time):
//
// 1. FOLDER TRUST — `~/.claude.json` → `projects["<path>"]
//    .hasTrustDialogAccepted`, keyed by the FORWARD-SLASH spelling of the
//    directory (backslash entries are invisible to the CLI). Until it is
//    true, the project's `.claude/` settings are ignored ENTIRELY —
//    reading settings from an untrusted folder would be the exact attack
//    the trust dialog exists to stop.
// 2. SERVER APPROVAL — the project's own `.claude/settings.local.json`:
//    `enabledMcpjsonServers` / `disabledMcpjsonServers`. A rejection
//    OUTRANKS an approval, so recording consent must also clear the name
//    from the disabled list (a declined chooser prompt in some earlier
//    Claude Code run otherwise silently kills the server forever).
//
// Every workspace-scope entry Vynel writes is consent-backed (the carded
// marketplace install, the add-server form, a skill's carded install) —
// and a Vynel WORKSPACE is a folder the user explicitly added, in which
// Vynel already runs sessions daily — so recording both halves belongs to
// the same single writer that writes the entry. Revoking on removal
// clears ONLY the approval: an uninstall is not a rejection, and folder
// trust is folder-level standing consent, never withdrawn per-server.
//
// Same protective posture as the mcp-config writer: other keys in both
// files are preserved verbatim; malformed JSON throws rather than
// clobbering.

import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolveMcpConfigPath } from './resolve-mcp-config-path.js'

export async function approveProjectMcpjsonServer(
  workspacePath: string,
  serverName: string,
): Promise<void> {
  await ensureProjectFolderTrusted(workspacePath)
  await updateProjectApproval(workspacePath, serverName, 'approve')
}

// The workspace path reaches the login's cwd from the same stored value,
// so forward-slashing it lands on exactly the key the CLI resolves.
async function ensureProjectFolderTrusted(workspacePath: string): Promise<void> {
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
  const key = workspacePath.replaceAll('\\', '/')
  const entry =
    typeof projects[key] === 'object' && projects[key] !== null
      ? { ...(projects[key] as Record<string, unknown>) }
      : {}
  if (entry.hasTrustDialogAccepted === true) return
  entry.hasTrustDialogAccepted = true
  projects[key] = entry
  await writeFile(configPath, JSON.stringify({ ...config, projects }, null, 2), 'utf8')
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
  const settingsPath = path.join(workspacePath, '.claude', 'settings.local.json')
  let raw: string
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    if (action === 'revoke') return
    raw = '{}'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Project settings at ${settingsPath} are malformed JSON and cannot be safely updated; ` +
        `repair or remove the file before retrying. Underlying parse error: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Project settings at ${settingsPath} are JSON but not an object.`)
  }
  const settings = parsed as Record<string, unknown>
  const enabled = asStringArray(settings.enabledMcpjsonServers)
  const disabled = asStringArray(settings.disabledMcpjsonServers)
  // No-op honesty (the sibling writer's promise): an already-recorded
  // verdict never rewrites the user's file — the login heal runs this on
  // EVERY Connect click.
  if (action === 'approve') {
    if (enabled.includes(serverName) && !disabled.includes(serverName)) return
    settings.enabledMcpjsonServers = enabled.includes(serverName)
      ? enabled
      : [...enabled, serverName]
    if (disabled.includes(serverName)) {
      settings.disabledMcpjsonServers = disabled.filter((name) => name !== serverName)
    }
  } else {
    if (!enabled.includes(serverName)) return
    settings.enabledMcpjsonServers = enabled.filter((name) => name !== serverName)
  }
  await mkdir(path.dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

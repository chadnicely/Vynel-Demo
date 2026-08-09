// Claude Code treats a project's `.mcp.json` servers as UNTRUSTED until the
// user approves them — and the CLI (2.1.213, probed live 2026-08-09) reads
// that verdict from the PROJECT's own `.claude/settings.local.json`:
// `enabledMcpjsonServers` / `disabledMcpjsonServers` (the legacy
// `~/.claude.json` projects arrays are dead — writing them changes
// nothing). A rejection OUTRANKS an approval, so recording consent must
// also clear the name from the disabled list (a declined prompt in some
// earlier Claude Code run otherwise silently kills the server forever).
//
// Every workspace-scope entry Vynel writes is consent-backed (the carded
// marketplace install, the add-server form, a skill's carded install), so
// recording the approval belongs to the same single writer that writes the
// entry. Revoking on removal clears ONLY the approval — Vynel's uninstall
// is not a rejection, so the disabled list is never touched there.
//
// Same protective posture as the mcp-config writer: other settings keys
// (permissions etc.) are preserved verbatim; malformed JSON throws rather
// than clobbering. `settings.local.json` is Claude's per-machine local
// settings file — the right home for a trust decision.

import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

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
  if (action === 'approve') {
    settings.enabledMcpjsonServers = enabled.includes(serverName)
      ? enabled
      : [...enabled, serverName]
    if (disabled.includes(serverName)) {
      settings.disabledMcpjsonServers = disabled.filter((name) => name !== serverName)
    }
  } else {
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

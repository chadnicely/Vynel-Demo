// Reads WHICH remote MCP servers hold a stored OAuth credential in Claude
// Code's own store (`~/.claude/.credentials.json` → `mcpOAuth`, keyed
// `<serverName>|<hash>`) — the persisted "Connected" state the UI shows.
//
// SECURITY: presence + expiry METADATA only. Token values are never read
// into the returned shape, never logged, never leave this module. Lenient
// like every registry read: a missing or unparsable store answers empty.

import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

export type McpOauthCredentialStatus = {
  serverName: string
  serverUrl: string | null
  /** False when the token is past `expiresAt` with no refresh token —
   * the CLI can't renew it silently, so a fresh sign-in is needed. */
  isUsable: boolean
}

export function listMcpOauthCredentialStatuses(
  homeDir = os.homedir(),
  now: () => number = Date.now,
): McpOauthCredentialStatus[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      readFileSync(path.join(homeDir, '.claude', '.credentials.json'), 'utf8'),
    )
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const mcpOauth = (parsed as Record<string, unknown>).mcpOAuth
  if (typeof mcpOauth !== 'object' || mcpOauth === null) return []
  const statuses: McpOauthCredentialStatus[] = []
  for (const [key, value] of Object.entries(mcpOauth as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const entry = value as Record<string, unknown>
    const serverName =
      typeof entry.serverName === 'string' && entry.serverName.length > 0
        ? entry.serverName
        : key.split('|')[0]!
    if (serverName.length === 0) continue
    const expiresAt = typeof entry.expiresAt === 'number' ? entry.expiresAt : null
    const hasRefreshToken = typeof entry.refreshToken === 'string' && entry.refreshToken.length > 0
    statuses.push({
      serverName,
      serverUrl: typeof entry.serverUrl === 'string' ? entry.serverUrl : null,
      isUsable: hasRefreshToken || expiresAt === null || expiresAt > now(),
    })
  }
  return statuses
}

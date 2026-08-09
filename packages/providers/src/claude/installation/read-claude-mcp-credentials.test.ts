// The credential-store presence read behind the UI's persisted "Connected"
// state. The fixture mirrors the real `~/.claude/.credentials.json` shape
// (probed live 2026-08-10): `mcpOAuth` keyed `<serverName>|<hash>`. The
// non-negotiable here: token VALUES never appear in the returned shape.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listMcpOauthCredentialStatuses } from './read-claude-mcp-credentials.js'

let homeDir: string | null = null

function writeStore(store: unknown): string {
  homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-creds-'))
  mkdirSync(join(homeDir, '.claude'), { recursive: true })
  writeFileSync(join(homeDir, '.claude', '.credentials.json'), JSON.stringify(store), 'utf8')
  return homeDir
}

afterEach(() => {
  if (homeDir !== null) rmSync(homeDir, { recursive: true, force: true })
  homeDir = null
})

const NOW = 1_754_800_000_000

describe('listMcpOauthCredentialStatuses', () => {
  it('reads presence + expiry metadata and NEVER the token values', () => {
    const dir = writeStore({
      claudeAiOauth: { accessToken: 'sk-ant-root-token' },
      mcpOAuth: {
        'sentry|800cb29a3ac61727': {
          serverName: 'sentry',
          serverUrl: 'https://mcp.sentry.dev/mcp',
          accessToken: 'secret-access-token',
          refreshToken: 'secret-refresh-token',
          expiresAt: NOW - 1_000, // expired, but renewable via the refresh token
        },
        'notion|eac663db915250e7': {
          serverName: 'notion',
          serverUrl: 'https://mcp.notion.com/mcp',
          accessToken: 'another-secret',
          expiresAt: NOW - 1_000, // expired with NO refresh token — unusable
        },
        'plugin:stripe:stripe|b6f5a41be97b6eed': {
          serverName: 'stripe',
          serverUrl: 'https://mcp.stripe.com',
          accessToken: 'stripe-secret',
          expiresAt: NOW + 60_000, // live token
        },
      },
    })
    const statuses = listMcpOauthCredentialStatuses(dir, () => NOW)
    expect(statuses).toEqual([
      { serverName: 'sentry', serverUrl: 'https://mcp.sentry.dev/mcp', isUsable: true },
      { serverName: 'notion', serverUrl: 'https://mcp.notion.com/mcp', isUsable: false },
      { serverName: 'stripe', serverUrl: 'https://mcp.stripe.com', isUsable: true },
    ])
    expect(JSON.stringify(statuses)).not.toContain('secret')
    expect(JSON.stringify(statuses)).not.toContain('sk-ant')
  })

  it('falls back to the key prefix when an entry lacks serverName, and skips junk', () => {
    const dir = writeStore({
      mcpOAuth: {
        'linear|abc123': { serverUrl: 'https://mcp.linear.app/mcp', accessToken: 'x' },
        '|orphan': { accessToken: 'y' }, // empty name — skipped
        'broken|def456': 'not-an-object', // skipped
      },
    })
    expect(listMcpOauthCredentialStatuses(dir, () => NOW)).toEqual([
      // No expiresAt in the store means the CLI owns renewal — treat as usable.
      { serverName: 'linear', serverUrl: 'https://mcp.linear.app/mcp', isUsable: true },
    ])
  })

  it('answers empty for a missing or unparsable store', () => {
    homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-creds-'))
    expect(listMcpOauthCredentialStatuses(homeDir, () => NOW)).toEqual([])
    mkdirSync(join(homeDir, '.claude'), { recursive: true })
    writeFileSync(join(homeDir, '.claude', '.credentials.json'), 'not json at all', 'utf8')
    expect(listMcpOauthCredentialStatuses(homeDir, () => NOW)).toEqual([])
  })
})

// The auth seam's ONLY logic is the argv boundary + the error mapping —
// exercised here against a real execFile with `process.execPath` (node) as
// the fake binary: node treats 'mcp' as a script path and fails fast with
// stderr, which drives the failure branch end-to-end. The live login/logout
// commands (browser round-trip, credential store) are Chad's smoke — tests
// never run the real CLI.

import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { loginClaudeMcpServer, logoutClaudeMcpServer } from './claude-mcp-cli.js'

describe('claude-mcp-cli error mapping', () => {
  it('a failed login maps to a typed, actionable error carrying the stderr tail', async () => {
    await expect(
      loginClaudeMcpServer({ serverName: 'linear', binaryPath: process.execPath }),
    ).rejects.toThrow(ValidationError)
    await expect(
      loginClaudeMcpServer({ serverName: 'linear', binaryPath: process.execPath }),
    ).rejects.toThrow(/Connecting 'linear' failed: .+/)
  })

  it('a failed logout says so in its own words', async () => {
    await expect(
      logoutClaudeMcpServer({ serverName: 'linear', binaryPath: process.execPath }),
    ).rejects.toThrow(/Signing out of 'linear' failed/)
  })

  it('refuses a leading-dash server name before any process spawns', async () => {
    await expect(
      loginClaudeMcpServer({ serverName: '--evil', binaryPath: process.execPath }),
    ).rejects.toThrow(/cannot start with '-'/)
  })
})

// The auth seam's logic: the argv boundary, the PowerShell hidden-console
// wrapper (the CLI's stdin.isTTY check makes every pipe-based login spawn
// impossible — smoked 2026-08-09), and the piped logout's error mapping.
// Exec paths run against `process.execPath` (node) as the fake binary —
// it fails fast, which drives each failure branch end-to-end; the real
// login (browser round-trip, credential store) is the live smoke.

import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
import {
  buildHiddenConsoleLoginScript,
  loginClaudeMcpServer,
  logoutClaudeMcpServer,
} from './claude-mcp-cli.js'

describe('buildHiddenConsoleLoginScript', () => {
  it('starts hidden, waits bounded, kills on timeout, and passes the exit code through', () => {
    const script = buildHiddenConsoleLoginScript('C:\\bin\\claude.exe', 'notion')
    expect(script).toContain("-FilePath 'C:\\bin\\claude.exe'")
    expect(script).toContain("-ArgumentList 'mcp','login','notion'")
    expect(script).toContain('-WindowStyle Hidden -PassThru')
    expect(script).toContain('-Timeout 300')
    expect(script).toContain('Stop-Process -Force')
    expect(script).toContain('exit 124')
    expect(script).toContain('exit $p.ExitCode')
    expect(script).not.toContain('-WorkingDirectory')
  })

  it('quotes embedded single quotes and includes the working directory when given', () => {
    const script = buildHiddenConsoleLoginScript(
      'C:\\bin\\claude.exe',
      "it's-a-server",
      "D:\\my ws\\o'brien",
    )
    expect(script).toContain("'it''s-a-server'")
    expect(script).toContain("-WorkingDirectory 'D:\\my ws\\o''brien'")
  })
})

describe('claude-mcp-cli error mapping', () => {
  // Windows-only assertion on purpose — the suite runs on the Windows dev
  // machine, where login rides the hidden-console wrapper (exit-code-based
  // errors; the child console's stderr is unreachable by design).
  it('a failed login maps to the actionable exit-code error', async () => {
    await expect(
      loginClaudeMcpServer({ serverName: 'linear', binaryPath: process.execPath }),
    ).rejects.toThrow(ValidationError)
    await expect(
      loginClaudeMcpServer({ serverName: 'linear', binaryPath: process.execPath }),
    ).rejects.toThrow(/didn't complete|failed:/)
  })

  it('a failed logout says so in its own words, carrying the stderr tail', async () => {
    await expect(
      logoutClaudeMcpServer({ serverName: 'linear', binaryPath: process.execPath }),
    ).rejects.toThrow(/Signing out of 'linear' failed/)
  })

  it('refuses a leading-dash server name before any process spawns', async () => {
    await expect(
      loginClaudeMcpServer({ serverName: '--evil', binaryPath: process.execPath }),
    ).rejects.toThrow(/cannot start with '-'/)
    await expect(
      logoutClaudeMcpServer({ serverName: '--evil', binaryPath: process.execPath }),
    ).rejects.toThrow(/cannot start with '-'/)
  })
})

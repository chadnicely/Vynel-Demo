// Tests for `readClaudeAuthenticationStatus` — stubs `spawnSync`, `readFile`,
// and `readHostOsEnvVar` so the five auth states are exercised deterministically
// without real Claude Code. End-to-end coverage is the step-27 smoke test.
// See `docs/blueprints/providers/blueprint.md §17.5`.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('./read-host-os-env-var.js', () => ({ readHostOsEnvVar: vi.fn() }))

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { readHostOsEnvVar } from './read-host-os-env-var.js'
import { readClaudeAuthenticationStatus } from './read-claude-authentication-status.js'

const mockSpawnSync = vi.mocked(spawnSync)
const mockReadFile = vi.mocked(readFile)
const mockReadHostOsEnvVar = vi.mocked(readHostOsEnvVar)

function setInstalled(installed: boolean): void {
  mockSpawnSync.mockReturnValue({ status: installed ? 0 : 1 } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  setInstalled(true)
  mockReadHostOsEnvVar.mockReturnValue(null)
  mockReadFile.mockRejectedValue(new Error('ENOENT'))
})

describe('readClaudeAuthenticationStatus', () => {
  it('returns isInstalled: false when the CLI is not on PATH', async () => {
    setInstalled(false)
    const status = await readClaudeAuthenticationStatus()
    expect(status.isInstalled).toBe(false)
    expect(status.isAuthenticated).toBe(false)
    expect(status.inactiveReason).toMatch(/not installed/i)
  })

  it('reports api-key auth when ANTHROPIC_API_KEY is set in the environment', async () => {
    mockReadHostOsEnvVar.mockImplementation((name) =>
      name === 'ANTHROPIC_API_KEY' ? 'sk-ant-test' : null,
    )
    const status = await readClaudeAuthenticationStatus()
    expect(status.isInstalled).toBe(true)
    expect(status.isAuthenticated).toBe(true)
    expect(status.authenticationMethod).toBe('api-key')
  })

  it('reports api-key auth when settings.json carries env.ANTHROPIC_API_KEY', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-x' } }) as never)
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(true)
    expect(status.authenticationMethod).toBe('api-key')
  })

  it('reports oauth auth when a valid .credentials.json exists', async () => {
    const future = Date.now() + 3_600_000
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        claudeAiOauth: { accessToken: 'tok', expiresAt: future },
        email: 'user@example.com',
      }) as never,
    )
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(true)
    expect(status.authenticationMethod).toBe('oauth')
    expect(status.authenticatedAccountLabel).toBe('user@example.com')
  })

  it('reports not-authenticated with an expiry reason when OAuth has expired', async () => {
    const past = Date.now() - 3_600_000
    mockReadFile.mockResolvedValue(
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: past } }) as never,
    )
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(false)
    expect(status.inactiveReason).toMatch(/expired/i)
  })
})

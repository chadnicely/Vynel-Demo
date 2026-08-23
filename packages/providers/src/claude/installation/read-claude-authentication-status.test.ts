// Tests for `readClaudeAuthenticationStatus` — stubs the bundled-binary
// resolver, `execFile`, `readFile`, and `readHostOsEnvVar` so the auth states
// are exercised deterministically without real Claude Code. End-to-end
// coverage is the step-27 smoke test.
//
// test: correct expectation for the oauth label — was the credentials-file's
// top-level email, should be the CLI's `auth status` JSON: the real
// `.credentials.json` carries NO identity fields, so the file fallback can
// only say "Authenticated"; email/org/plan come from the CLI report.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('./read-host-os-env-var.js', () => ({ readHostOsEnvVar: vi.fn() }))
vi.mock('./claude-plugin-cli.js', () => ({ resolveBundledClaudeBinary: vi.fn() }))

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { ValidationError } from '@vynel/errors'
import { readHostOsEnvVar } from './read-host-os-env-var.js'
import { resolveBundledClaudeBinary } from './claude-plugin-cli.js'
import { readClaudeAuthenticationStatus } from './read-claude-authentication-status.js'

const mockResolveBundledClaudeBinary = vi.mocked(resolveBundledClaudeBinary)
const mockExecFile = vi.mocked(execFile)
const mockReadFile = vi.mocked(readFile)
const mockReadHostOsEnvVar = vi.mocked(readHostOsEnvVar)

// "Installed" is the SDK's bundled binary resolving (the engine the sessions
// run on); a torn install throws from the resolver. The status itself is the
// CLI's own `auth status` JSON (promisify drives the mocked execFile through
// its callback).
function setCli(options: { installed: boolean; statusOutput?: string }): void {
  mockResolveBundledClaudeBinary.mockImplementation(() => {
    if (!options.installed) {
      throw new ValidationError('The Claude engine binary for this platform is not installed')
    }
    return '/vynel/engine/claude'
  })
  mockExecFile.mockImplementation(((
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, io: { stdout: string; stderr: string }) => void,
  ) => {
    callback(null, { stdout: options.statusOutput ?? '', stderr: '' })
    return {} as never
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  setCli({ installed: true })
  mockReadHostOsEnvVar.mockReturnValue(null)
  mockReadFile.mockRejectedValue(new Error('ENOENT'))
})

describe('readClaudeAuthenticationStatus', () => {
  it('returns isInstalled: false, quoting the resolver, when the bundled engine is missing', async () => {
    setCli({ installed: false })
    const status = await readClaudeAuthenticationStatus()
    expect(status.isInstalled).toBe(false)
    expect(status.isAuthenticated).toBe(false)
    expect(status.inactiveReason).toMatch(/engine binary .* not installed/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('runs the bundled binary for auth status — never a host claude on PATH', async () => {
    setCli({ installed: true, statusOutput: JSON.stringify({ loggedIn: false }) })
    await readClaudeAuthenticationStatus()
    expect(mockExecFile).toHaveBeenCalledWith(
      '/vynel/engine/claude',
      ['auth', 'status'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    )
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

  it("reads identity from the CLI's own auth status JSON — email, org, plan", async () => {
    setCli({
      installed: true,
      statusOutput: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        email: 'user@example.com',
        orgName: "User's Organization",
        subscriptionType: 'max',
      }),
    })
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(true)
    expect(status.authenticationMethod).toBe('oauth')
    expect(status.authenticatedAccountLabel).toBe('user@example.com')
    expect(status.email).toBe('user@example.com')
    expect(status.organizationName).toBe("User's Organization")
    expect(status.subscriptionPlan).toBe('max')
  })

  it('trusts the CLI when it reports logged out, even with a credentials file on disk', async () => {
    setCli({ installed: true, statusOutput: JSON.stringify({ loggedIn: false }) })
    mockReadFile.mockImplementation(((filePath: string) =>
      filePath.endsWith('.credentials.json')
        ? Promise.resolve(
            JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 1000 } }),
          )
        : Promise.reject(new Error('ENOENT'))) as never)
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(false)
    expect(status.inactiveReason).toMatch(/not authenticated/i)
  })

  it('falls back to the credentials file when the CLI prints no JSON (older CLIs)', async () => {
    const future = Date.now() + 3_600_000
    mockReadFile.mockImplementation(((filePath: string) =>
      filePath.endsWith('.credentials.json')
        ? Promise.resolve(
            JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: future } }),
          )
        : Promise.reject(new Error('ENOENT'))) as never)
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(true)
    expect(status.authenticationMethod).toBe('oauth')
    // The file carries no identity — the fallback can only report presence.
    expect(status.authenticatedAccountLabel).toBe('Authenticated')
    expect(status.email).toBeNull()
  })

  it('reports not-authenticated with an expiry reason when OAuth has expired', async () => {
    const past = Date.now() - 3_600_000
    mockReadFile.mockImplementation(((filePath: string) =>
      filePath.endsWith('.credentials.json')
        ? Promise.resolve(JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: past } }))
        : Promise.reject(new Error('ENOENT'))) as never)
    const status = await readClaudeAuthenticationStatus()
    expect(status.isAuthenticated).toBe(false)
    expect(status.inactiveReason).toMatch(/expired/i)
  })
})

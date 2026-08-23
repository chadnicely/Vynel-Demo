import { describe, expect, it } from 'vitest'
import { parseGitHubAuthStatus, readGitHubAuthStatus } from './github-auth-status.js'

describe('parseGitHubAuthStatus', () => {
  it('reads the signed-in handle off a real status block', () => {
    expect(
      parseGitHubAuthStatus(
        'github.com\n  ✓ Logged in to github.com account chadnicely (keyring)\n  - Active account: true',
      ),
    ).toEqual({
      isInstalled: true,
      isAuthenticated: true,
      accountLabel: 'chadnicely',
      inactiveReason: null,
    })
  })

  it('no account line reads as signed out, not an error', () => {
    const status = parseGitHubAuthStatus('github.com\n  X Failed to log in')
    expect(status.isInstalled).toBe(true)
    expect(status.isAuthenticated).toBe(false)
    expect(status.inactiveReason).toBe('Not signed in')
  })
})

describe('readGitHubAuthStatus', () => {
  it('reads status from stderr too — older gh builds print there', async () => {
    const status = await readGitHubAuthStatus(async () => ({
      stdout: '',
      stderr: '✓ Logged in to github.com account sam (keyring)',
    }))
    expect(status.accountLabel).toBe('sam')
  })

  it('gh exiting 1 with output is DATA: installed, signed out', async () => {
    const status = await readGitHubAuthStatus(async () => {
      throw Object.assign(new Error('exit 1'), {
        stdout: '',
        stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
      })
    })
    expect(status).toEqual({
      isInstalled: true,
      isAuthenticated: false,
      accountLabel: null,
      inactiveReason: 'Not signed in',
    })
  })

  it('a spawn error with no output is "not installed"', async () => {
    const status = await readGitHubAuthStatus(async () => {
      // promisify(execFile) attaches EMPTY stdout/stderr strings to every
      // rejection — the fake must too, or a wrong branch passes.
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' })
    })
    expect(status.isInstalled).toBe(false)
    expect(status.inactiveReason).toContain('not installed')
  })
})

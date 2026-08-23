// Sign the CLI out of github.com — non-interactive, and the credential leaves
// with it: `gh` removes its own store entry. Idempotent: signing out while
// already signed out is a no-op, not a failure. `--user` names the account
// so gh's multi-account mode never asks.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CommandRunner } from './github-auth-status.js'

const run = promisify(execFile)
const LOGOUT_TIMEOUT_MS = 20_000

const defaultRunner: CommandRunner = async (file, args) => {
  const { stdout, stderr } = await run(file, args, {
    timeout: LOGOUT_TIMEOUT_MS,
    windowsHide: true,
  })
  return { stdout, stderr }
}

export async function signGitHubOut(
  accountLabel: string,
  runCommand: CommandRunner = defaultRunner,
): Promise<void> {
  try {
    await runCommand('gh', ['auth', 'logout', '--hostname', 'github.com', '--user', accountLabel])
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { stderr?: string }
    if (/not logged in/i.test(failed.stderr ?? '')) return
    throw error
  }
}

// The GitHub sign-in state, read from `gh auth status` — the one authoritative
// local read (the CLI keeps the token in the OS credential store; Vynel never
// sees it). Three honest answers, none an error: signed in (with the handle),
// installed but signed out (gh exits 1 — that is data), not installed (a
// spawn error with no output at all).
//
// SHAPE: fixed argument lists via execFile; the runner is injectable so tests
// never spawn. Ported from Chad's design branch.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const STATUS_TIMEOUT_MS = 10_000

export type GitHubAuthStatus = {
  isInstalled: boolean
  isAuthenticated: boolean
  /** The signed-in handle — "chadnicely" — when the CLI reports one. */
  accountLabel: string | null
  /** "The GitHub CLI (gh) is not installed", "Not signed in" — null when signed in. */
  inactiveReason: string | null
}

export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>

export const defaultCommandRunner: CommandRunner = async (file, args) => {
  const { stdout, stderr } = await run(file, args, {
    timeout: STATUS_TIMEOUT_MS,
    windowsHide: true,
  })
  return { stdout, stderr }
}

export const GH_NOT_INSTALLED_REASON = 'The GitHub CLI (gh) is not installed'

export async function readGitHubAuthStatus(
  runCommand: CommandRunner = defaultCommandRunner,
): Promise<GitHubAuthStatus> {
  let output: string
  try {
    // Older gh builds print status to stderr — read both, always.
    const { stdout, stderr } = await runCommand('gh', ['auth', 'status'])
    output = `${stdout}\n${stderr}`
  } catch (error) {
    // A missing binary is a spawn error (ENOENT) — branch on THAT, not on
    // output presence: promisify(execFile) attaches EMPTY stdout/stderr
    // strings to every rejection, so "no output" distinguishes nothing.
    // Exit 1 = installed but signed out (gh's own convention) — read what it wrote.
    const failed = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (failed.code === 'ENOENT') {
      return {
        isInstalled: false,
        isAuthenticated: false,
        accountLabel: null,
        inactiveReason: GH_NOT_INSTALLED_REASON,
      }
    }
    return parseGitHubAuthStatus(`${failed.stdout ?? ''}\n${failed.stderr ?? ''}`)
  }
  return parseGitHubAuthStatus(output)
}

/** Exported for tests — parsing is where the risk lives, not spawning. */
export function parseGitHubAuthStatus(output: string): GitHubAuthStatus {
  // "✓ Logged in to github.com account chadnicely (keyring)"
  const account = /Logged in to [^\s]+ account (\S+)/.exec(output)?.[1] ?? null
  if (account === null) {
    return {
      isInstalled: true,
      isAuthenticated: false,
      accountLabel: null,
      inactiveReason: 'Not signed in',
    }
  }
  return { isInstalled: true, isAuthenticated: true, accountLabel: account, inactiveReason: null }
}

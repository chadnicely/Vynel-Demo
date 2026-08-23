// The ONE place Vynel runs git itself: the scaffold's first commit, the
// repository door's clone, and the facts on the workspace header. Every other
// git operation happens inside the sessions, on Bash, with the machine's own
// credential helper — Vynel keeps state, it does not drive the repository
// (docs/module-notes/github-connection.md).
//
// SHAPE: fixed argument lists via execFile — never a shell — and
// `protocol.ext.allow=never` on every call so no pasted address can become a
// command. `--no-optional-locks` keeps a background read from fighting the
// session's own git over the index lock. Injectable so tests never shell out.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// A `git status` on a big repository can be chatty; never truncate it.
const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024

/** Runs git in `cwd` with fixed arguments; resolves to what git printed. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

/** What promisify(execFile) rejects with — the exit code's output rides along. */
export type GitFailure = NodeJS.ErrnoException & {
  stdout?: string
  stderr?: string
  killed?: boolean
}

export function makeGitRunner(timeoutMs: number): GitRunner {
  return async (args, cwd) => {
    const { stdout } = await run(
      'git',
      ['--no-optional-locks', '-c', 'protocol.ext.allow=never', ...args],
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: OUTPUT_LIMIT_BYTES },
    )
    return stdout
  }
}

export const GIT_TIMEOUT_MS = 20_000

export const defaultGitRunner: GitRunner = makeGitRunner(GIT_TIMEOUT_MS)

export function isGitMissing(error: unknown): boolean {
  return (error as GitFailure | null)?.code === 'ENOENT'
}

export function isNotARepository(error: unknown): boolean {
  return /not a git repository/i.test(readGitOutput(error))
}

export function readGitOutput(error: unknown): string {
  const failure = error as GitFailure | null
  return `${failure?.stderr ?? ''}\n${failure?.message ?? ''}`
}

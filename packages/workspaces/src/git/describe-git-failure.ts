// The reason a person can act on when git fails: git missing, the command
// timing out, or git's own first meaningful line — never the raw command
// line (which would echo a pasted address, token and all).

import { isGitMissing, readGitOutput, type GitFailure } from './run-git.js'

export const GIT_MISSING_REASON = "git isn't installed on this computer (or isn't on PATH)"

export function describeGitFailure(
  error: unknown,
  wording: { timedOut: string; fallback: string },
): string {
  if (isGitMissing(error)) return GIT_MISSING_REASON
  if ((error as GitFailure | null)?.killed) return wording.timedOut
  return cleanGitError(readGitOutput(error), wording.fallback)
}

function cleanGitError(output: string, fallback: string): string {
  const lines = output
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('Command failed'))
  const line =
    lines.find(
      (entry) => entry.toLowerCase().includes('fatal:') || entry.toLowerCase().includes('error:'),
    ) ?? lines[0]
  const picked = (line ?? '').replace(/^fatal:\s*/i, '').trim()
  return picked === '' ? fallback : picked
}

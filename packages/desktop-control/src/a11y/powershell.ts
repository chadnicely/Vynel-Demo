// The shared PowerShell runner for the a11y layer's Win32 operations (focus,
// window state, the screen-reader flag). Extracted from `window-focus.ts` so
// `window-state.ts` can reach the same runner without a circular import — the
// one home for "run a short PowerShell command, best-effort, bounded".

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type PowerShellRunner = (command: string) => Promise<string>

// A wedged PowerShell spawn must not hang the caller before any wake deadline
// is even armed — the same never-hang class the probe timeout closes.
const POWERSHELL_TIMEOUT_MS = 10_000

/** Run a PowerShell command, returning stdout — '' on any failure (best-effort). */
export const runPowerShell: PowerShellRunner = async (command) => {
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS },
    )
    return stdout
  } catch {
    // Best-effort by design — the caller treats '' as "the operation reported
    // nothing", and its own deadline/guard bounds the consequence.
    return ''
  }
}

/** Parse a PowerShell boolean echo ("True"/"False", any casing, trailing newline). */
export function parseBooleanResult(stdout: string): boolean {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines[lines.length - 1]?.toLowerCase() === 'true'
}

// `resolveClaudeCodeExecutablePath` — cross-platform resolution of the
// `claude` CLI executable. Searches the host PATH; on Windows looks for the
// `.exe` / `.cmd` / `.bat` variants. Falls back to the bare command name —
// `spawnSync` then resolves it, and a not-found result is reported as "not
// installed" by `readClaudeAuthenticationStatus`.
// See `docs/blueprints/providers/blueprint.md §11.5`.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readHostOsEnvVar } from './read-host-os-env-var.js'

export function resolveClaudeCodeExecutablePath(): string {
  const isWindows = process.platform === 'win32'
  const candidateNames = isWindows ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude']
  const pathEntries = (readHostOsEnvVar('PATH') ?? '').split(isWindows ? ';' : ':')

  for (const directory of pathEntries) {
    if (directory.length === 0) continue
    for (const name of candidateNames) {
      const candidatePath = join(directory, name)
      if (existsSync(candidatePath)) {
        return candidatePath
      }
    }
  }

  // Not found on PATH — return the bare command; `spawnSync` resolves it, and
  // the caller treats a non-zero exit / spawn error as "not installed".
  return candidateNames[0] ?? 'claude'
}

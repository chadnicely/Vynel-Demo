// File-level env ops for one workspace app — resolve the app's env file
// (containment-checked, the supervisor's cwd discipline), read it into
// entries, and write a desired entry set back line-preservingly.
//
// SECURITY SHAPE: same trust domain as the supervisor — it is the user's own
// file in their own workspace — but the PATH is guarded: the env file must
// resolve inside the workspace (`resolveContainedCwd`, the one home for the
// containment rule). Errors are taxonomy-free strings (the supervisor
// precedent); the route maps them to typed VynelErrors. Values are secrets by
// nature: callers must never log them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveContainedCwd } from '../running/app-process-supervisor.js'
import {
  parseEnvFileText,
  applyEnvEntriesToText,
  hasMultilineQuotedValue,
  ENV_KEY_PATTERN,
  type AppEnvEntry,
} from './env-file.js'

export type { AppEnvEntry } from './env-file.js'

export interface AppEnvFileRef {
  workspacePath: string
  cwdRelative: string // '' = workspace root
  envFileRelative: string // relative to the app's folder, e.g. '.env'
}

/** The env file's absolute path, or null when it escapes the workspace. */
export function resolveAppEnvFilePath(ref: AppEnvFileRef): string | null {
  const combined = ref.cwdRelative
    ? `${ref.cwdRelative}/${ref.envFileRelative}`
    : ref.envFileRelative
  return resolveContainedCwd(ref.workspacePath, combined)
}

export function readAppEnvFile(ref: AppEnvFileRef): { exists: boolean; entries: AppEnvEntry[] } {
  const path = resolveAppEnvFilePath(ref)
  if (path === null) throw new Error('app_env_escapes_workspace')
  if (!existsSync(path)) return { exists: false, entries: [] }
  return { exists: true, entries: parseEnvFileText(readFileSync(path, 'utf8')) }
}

/** Write the FULL desired entry set (absent keys are removed). Creates the
 *  file when missing; the app's folder itself must exist. */
export function writeAppEnvFile(ref: AppEnvFileRef, entries: AppEnvEntry[]): AppEnvEntry[] {
  const seenKeys = new Set<string>()
  for (const entry of entries) {
    // Defense at both boundaries — the route schema validates the same rules.
    if (!ENV_KEY_PATTERN.test(entry.key)) throw new Error(`app_env_invalid_key:${entry.key}`)
    if (/[\r\n]/.test(entry.value)) throw new Error(`app_env_multiline_value:${entry.key}`)
    if (seenKeys.has(entry.key)) throw new Error(`app_env_duplicate_key:${entry.key}`)
    seenKeys.add(entry.key)
  }

  const path = resolveAppEnvFilePath(ref)
  if (path === null) throw new Error('app_env_escapes_workspace')
  if (!existsSync(dirname(path))) throw new Error('app_env_folder_missing')

  const existingText = existsSync(path) ? readFileSync(path, 'utf8') : ''
  // A line-based rewrite of a multi-line quoted value would fragment the
  // secret and orphan its continuation lines — refuse the whole edit.
  if (hasMultilineQuotedValue(existingText)) throw new Error('app_env_multiline_file')
  writeFileSync(path, applyEnvEntriesToText(existingText, entries))
  return parseEnvFileText(readFileSync(path, 'utf8'))
}

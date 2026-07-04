// Resolves the on-disk root directory for a skill scope.
//
// **Host-OS state read — carved out.** This file is one of three
// whitelisted host-OS state reads in the `skills` domain (the
// others are `resolve-mcp-config-path.ts` and the shared
// `resolve-host-home-dir.ts` seam they both consume). Per the
// `readHostOsEnvVar` precedent from providers (MEMORY 2026-05-21,
// architectural precedents), host-OS state inspection lives in
// single grep-able internal helpers; the code-reviewer
// whitelists these paths only.
//
// Pure sync function — no async, no I/O. The home-dir lookup
// routes through `resolveHostHomeDir()` so tests can isolate to a
// per-test tmpdir (skills tests would otherwise race on the real
// `~/.claude/skills/`).

import path from 'node:path'
import type { SkillScope } from '../repositories/index.js'
import { resolveHostHomeDir } from './resolve-host-home-dir.js'

export function resolveSkillsRoot(scope: SkillScope, workspacePath?: string): string {
  if (scope === 'user') {
    return path.join(resolveHostHomeDir(), '.claude', 'skills')
  }
  if (!workspacePath) {
    throw new Error('resolveSkillsRoot: workspacePath required for workspace scope')
  }
  return path.join(workspacePath, '.claude', 'skills')
}

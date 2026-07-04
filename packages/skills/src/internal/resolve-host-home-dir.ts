// Host-OS home-dir lookup with test-override seam. The skills
// domain writes to `~/.claude/skills/` (user-scope SKILL.md) and
// `~/.claude.json` (user-scope MCP config) — both call
// `resolveHostHomeDir()` instead of `os.homedir()` directly so
// tests can isolate the host home dir to a per-test tmpdir via
// `withHomeDir(tmpDir, async () => {...})`. Without the seam, 8
// skills test files race on the real `~/.claude/skills/` directory
// when vitest runs them in parallel.
//
// **Host-OS state read — carved out.** Companion to
// `resolve-skills-root.ts` + `resolve-mcp-config-path.ts`. Per the
// MEMORY 2026-05-21 architectural precedent for host-OS state
// inspection — `os.homedir()` access lives in a single grep-able
// internal helper; the code-reviewer whitelists this path only.
//
// Tests-only override: the module-level mutable below is NEVER
// touched by production code. `withHomeDir` is a test-support
// surface — used by the 8 skills test files that touch
// user-scope paths. Vitest workers are separate processes, so the
// module-level value is isolated per-worker. Within a worker,
// tests MUST wrap their body in `withHomeDir(...)` to ensure
// cleanup; tests that forget will leak the override into
// subsequent tests in the same worker.

import os from 'node:os'

let homeOverride: string | undefined

export function resolveHostHomeDir(): string {
  return homeOverride ?? os.homedir()
}

export async function withHomeDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = homeOverride
  homeOverride = dir
  try {
    return await fn()
  } finally {
    homeOverride = previous
  }
}

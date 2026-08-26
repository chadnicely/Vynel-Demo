// Host-OS home-dir lookup with test-override seam — the agents-domain
// twin of `skills/src/internal/resolve-host-home-dir.ts`. The agents
// domain writes the user-scope transparency mirror to
// `~/.claude/agents/<slug>.md`; every touch routes through
// `resolveHostHomeDir()` instead of `os.homedir()` so tests can isolate
// the host home dir to a per-test tmpdir via `withHomeDir`.
//
// **Host-OS state read — carved out.** Per the MEMORY 2026-05-21
// architectural precedent, host-OS state inspection lives in a single
// grep-able internal helper PER DOMAIN (the code-reviewer whitelists
// these paths only). Deliberately a TWIN, not a shared package: the
// override below is module-level mutable state, and sharing one module
// across leaves would couple their tests' home isolation. Extract a
// shared home on the THIRD consumer (same rule as the zip extractor —
// `docs/module-notes/marketplace-kinds.md` "Deferred").
//
// Tests-only override: production code NEVER touches `withHomeDir`.
// Vitest workers are separate processes, so the module-level value is
// isolated per-worker; tests MUST wrap their body in `withHomeDir(...)`
// to guarantee cleanup.

import os from 'node:os'

let homeOverride: string | undefined

export function resolveHostHomeDir(): string {
  return homeOverride ?? os.homedir()
}

/** Hook-shaped twin of `withHomeDir` for a whole test file: call in
 *  `beforeEach`, invoke the returned restore in `afterEach`. */
export function beginHomeDirOverride(dir: string): () => void {
  const previous = homeOverride
  homeOverride = dir
  return () => {
    homeOverride = previous
  }
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

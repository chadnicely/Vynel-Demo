// Test-support re-export of the agents host-home-dir seam, for
// CROSS-PACKAGE tests that exercise user-scope agent installs and must
// isolate the real `~/.claude/agents/` to a tmpdir (the `apps/local-api`
// marketplace route tests drive install/uninstall through the HTTP
// stack, which reaches `resolveHostHomeDir()` inside the mirror writer).
// NOTE: this seam is per-domain module state — a test that touches both
// skills AND agents user-scope paths must wrap BOTH packages' overrides.
// In-package tests import the seam directly; production code NEVER
// touches it. Follows `@vynel/skills/test-support`.

export { withHomeDir } from '../internal/resolve-host-home-dir.js'

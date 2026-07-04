// Test-support re-export of the host-home-dir seam, for CROSS-PACKAGE
// tests that exercise user-scope skill installs and must isolate the
// real `~/.claude/skills/` to a tmpdir (the `apps/local-api` skills
// route tests drive install/enable/disable/uninstall through the HTTP
// stack, which reaches `resolveHostHomeDir()` deep inside the install
// core op). In-package tests import the seam directly from
// `../internal/resolve-host-home-dir.js`; production code NEVER touches
// it. Follows the embeddings test-support precedent
// (`@vynel/embeddings/test-support`).

export { withHomeDir } from '../internal/resolve-host-home-dir.js'

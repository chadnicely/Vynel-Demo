// Test-only doors into the agents leaf: the home-dir seam, and the ROW op
// for tests that need an agent as a fixture without the disk mirror
// `createAgent` writes for every source (a user-scope fixture would land in
// the developer's real ~/.claude/agents otherwise).

export { withHomeDir } from './host-home-dir.js'
export { beginHomeDirOverride } from '../internal/resolve-host-home-dir.js'
export { createAgentRow as createAgentRowForTest } from '../lifecycle/create-agent-row.js'

// The first-party capability catalog — the known set of Vynel capabilities a
// user can enable per workspace. Pure data + a lookup; no DB, no cross-domain
// imports (the runtime contribution lives in the session-build). Marketplace
// capabilities (Phase C) are NOT in this catalog — they're identified by an
// arbitrary plugin id stored as open text in `workspace_capabilities`.

import type { Capability } from './capabilities-types.js'

export const CAPABILITY_CATALOG: readonly Capability[] = [
  {
    id: 'memory',
    displayName: 'Memory',
    description: 'Remembers facts about you and your work, and grounds the agent in them each turn.',
    scope: 'workspace',
    isFirstParty: true,
  },
  {
    id: 'knowledge',
    displayName: 'Knowledge',
    description: 'Indexes a folder so the agent can search your documents.',
    scope: 'workspace',
    isFirstParty: true,
  },
] as const

// `find*` — returns null when the id isn't a known first-party capability
// (e.g. a marketplace plugin id), per the find/get naming convention.
export function findCapabilityById(capabilityId: string): Capability | null {
  return CAPABILITY_CATALOG.find((entry) => entry.id === capabilityId) ?? null
}

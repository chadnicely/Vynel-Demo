// The first-party capability catalog — the known set of Vynel capabilities a
// user can enable per workspace. Pure data + a lookup; no DB, no cross-domain
// imports (the runtime contribution lives in the session-build). Marketplace
// capabilities (Phase C) are NOT in this catalog — they're identified by an
// arbitrary plugin id stored as open text in `workspace_capabilities`.

import type { Capability } from './capabilities-types.js'

export const CAPABILITY_CATALOG: readonly Capability[] = [
  // Both core capabilities default ON: their writes still card / stay
  // approval-gated, and a user who adds a memory or a knowledge folder
  // through the UI plainly expects the assistant to be able to use it —
  // an off-by-default read gate just reads as "broken" (vision litmus).
  {
    id: 'memory',
    displayName: 'Memory',
    description: 'Remembers facts about you and your work, and grounds the agent in them each turn.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'knowledge',
    displayName: 'Knowledge',
    description: 'Indexes a folder so the agent can search your documents.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'notebook',
    displayName: 'Notebook',
    description:
      'Curated playbooks the assistant consults before multi-step tasks — verified books from the team plus your own.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'tasks',
    displayName: 'Tasks',
    description:
      'A visible to-do list the assistant keeps while it works — what is planned, in progress, and done.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'plans',
    displayName: 'Plans',
    description:
      'Date-wise plans the assistant helps keep — what each day is for, with its tasks linked underneath.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'phases',
    displayName: 'Phases',
    description:
      'The engineering build plan the assistant keeps — how the app gets built, stage by stage, each with its full write-up.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'features',
    displayName: 'Features',
    description:
      'The catalog of what the app should have — each feature a full write-up, linked to the build phase that delivers it.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
  {
    id: 'journal',
    displayName: 'Journal',
    description:
      'A daily work journal the assistant writes and reads — what happened each day, so it can pick threads back up.',
    scope: 'workspace',
    isFirstParty: true,
    defaultEnabled: true,
  },
] as const

// `find*` — returns null when the id isn't a known first-party capability
// (e.g. a marketplace plugin id), per the find/get naming convention.
export function findCapabilityById(capabilityId: string): Capability | null {
  return CAPABILITY_CATALOG.find((entry) => entry.id === capabilityId) ?? null
}

// The catalog-default enabled set — what a scope with NO toggle surface (the
// global root has no workspace, so no `workspace_capabilities` override rows
// can exist for it) resolves to. Global-root turn composers pass this to
// `composeSessionMcpServers` so a defaultEnabled capability's gated tools
// (the notebook's) aren't denied there.
export function defaultEnabledCapabilityIds(): ReadonlySet<string> {
  return new Set(
    CAPABILITY_CATALOG.filter((capability) => capability.defaultEnabled).map(
      (capability) => capability.id,
    ),
  )
}

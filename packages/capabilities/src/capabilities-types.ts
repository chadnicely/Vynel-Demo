// Types for the `capabilities` domain — the per-workspace opt-in capability
// model.

// Known first-party capability ids. Marketplace capabilities (Phase C) use an
// arbitrary plugin id stored as open text in `workspace_capabilities.capabilityId`;
// they are NOT part of this union — the catalog only describes first-party ones.
export type CapabilityId = 'memory' | 'knowledge' | 'notebook' | 'tasks' | 'plans' | 'journal'

// Phase 1: every capability is workspace-scoped (memory/knowledge are per
// workspace — "don't use global memory", user directive 2026-06-20). Knowledge
// gains a global-vs-workspace folder choice in Phase B, but enablement itself
// stays workspace-scoped.
export type CapabilityScope = 'workspace'

// A first-party capability definition from the catalog. Pure metadata — the
// runtime contribution (MCP tools, system-prompt instruction, context snapshot)
// is assembled in the session-build (apps/local-api), not here, so this stays free of
// cross-domain imports.
export interface Capability {
  id: CapabilityId
  displayName: string
  description: string
  scope: CapabilityScope
  isFirstParty: boolean
  /** Enabled with NO explicit `workspace_capabilities` row — a row is an
   *  override (the toggle panel writes one, either way). Discovered live
   *  2026-07-11: nothing seeds rows, so a no-row-means-off default left
   *  memory + knowledge silently dead in every session on a fresh install. */
  defaultEnabled: boolean
}

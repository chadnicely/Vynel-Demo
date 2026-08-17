// Maps the Agent SDK's initialize-response `ModelInfo[]` (the models the
// user's engine + account actually serve) into the provider seam's
// `DiscoveredProviderModel[]`. Canonicalize on `resolvedModel ?? value`, keep
// only real `claude-…` wire ids, and dedupe — several rows point at ONE model.
//
// Naming is the whole job here, because the engine's rows are mostly ALIASES.
// A live roster (2026-08-17) looked like this:
//
//   value 'default'            → claude-opus-5[1m]  "Default (recommended)"
//   value 'opus[1m]'           → claude-opus-5[1m]  "Opus (1M context)"
//   value 'claude-fable-5[1m]' → claude-fable-5     "Fable"
//   value 'sonnet'             → claude-sonnet-5    "Sonnet"
//
// Not one row is "explicit" (`value === id`), so first-row-wins handed Opus
// the label of the generic pointer — the picker showed "Default
// (recommended)" and the user read it as "Opus is missing". Rank the rows
// instead: a real wire-id row beats a NAMED alias, which beats `default`.

import type { ModelInfo } from './claude-agent-sdk.js'
import type { DiscoveredProviderModel } from '../../shared/start-chat-session-input.js'

const CLAUDE_WIRE_ID = /^claude-/
/** The engine's generic "whatever is best today" pointer — never a name. */
const GENERIC_ALIAS = 'default'

/** 2 = the row IS the wire id · 1 = a named alias · 0 = the generic pointer. */
function labelRank(info: ModelInfo, id: string): number {
  if (info.value === id) return 2
  return info.value === GENERIC_ALIAS ? 0 : 1
}

export function mapClaudeModelInfo(models: ModelInfo[]): DiscoveredProviderModel[] {
  const byId = new Map<string, { model: DiscoveredProviderModel; rank: number }>()
  for (const info of models) {
    const id = info.resolvedModel ?? info.value
    if (typeof id !== 'string' || !CLAUDE_WIRE_ID.test(id)) continue
    const rank = labelRank(info, id)
    const existing = byId.get(id)
    // Strictly better only — ties keep the first row (stable, engine order).
    if (existing !== undefined && existing.rank >= rank) continue
    byId.set(id, {
      rank,
      model: {
        id,
        label: info.displayName !== '' ? info.displayName : id,
        description: info.description !== '' ? info.description : null,
        supportedEffortLevels: info.supportedEffortLevels ?? null,
      },
    })
  }
  return Array.from(byId.values(), (entry) => entry.model)
}

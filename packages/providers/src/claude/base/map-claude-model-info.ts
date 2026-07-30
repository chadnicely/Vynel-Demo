// Maps the Agent SDK's initialize-response `ModelInfo[]` (the models the
// user's engine + account actually serve) into the provider seam's
// `DiscoveredProviderModel[]`. The SDK list mixes explicit rows with ALIAS
// rows ('sonnet' → claude-sonnet-5, 'default' → …): canonicalize on
// `resolvedModel ?? value`, keep only real `claude-…` wire ids, and dedupe —
// an explicit row's label wins over an alias row's for the same model.

import type { ModelInfo } from './claude-agent-sdk.js'
import type { DiscoveredProviderModel } from '../../shared/start-chat-session-input.js'

const CLAUDE_WIRE_ID = /^claude-/

export function mapClaudeModelInfo(models: ModelInfo[]): DiscoveredProviderModel[] {
  const byId = new Map<string, { model: DiscoveredProviderModel; isExplicitRow: boolean }>()
  for (const info of models) {
    const id = info.resolvedModel ?? info.value
    if (typeof id !== 'string' || !CLAUDE_WIRE_ID.test(id)) continue
    const isExplicitRow = info.value === id
    const existing = byId.get(id)
    if (existing !== undefined && (existing.isExplicitRow || !isExplicitRow)) continue
    byId.set(id, {
      isExplicitRow,
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

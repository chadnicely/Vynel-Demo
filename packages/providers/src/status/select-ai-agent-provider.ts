// Selects the provider instance that serves a requested id. Prefers the
// caller's active instance (the API's injected `c.var.aiProvider` — a fake in
// route tests) when it serves that id; any other id falls back to
// `resolveAiAgentProvider`, so unregistered ids keep the `ValidationError`
// (HTTP 400) contract and later-phase registered providers still resolve.
// Internal to the status ops — not part of the package surface.

import { resolveAiAgentProvider } from '../registry.js'
import type { AiAgentProvider } from '../shared/ai-agent-provider.js'
import type { AiAgentProviderId } from '../shared/ai-agent-provider-id.js'

export function selectAiAgentProvider(
  providerId: AiAgentProviderId,
  activeProvider?: AiAgentProvider,
): AiAgentProvider {
  if (activeProvider !== undefined && activeProvider.providerId === providerId) {
    return activeProvider
  }
  return resolveAiAgentProvider(providerId)
}

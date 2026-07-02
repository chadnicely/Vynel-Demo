// The provider registry — `resolveAiAgentProvider`,
// `listAvailableAiAgentProviders`, `listAvailableAiAgentProviderIds`. A
// process-level singleton `Map`: each concrete provider is stateful (it holds
// active sessions + pending approvals), so exactly one instance per provider
// lives for the life of the process. Phase 1 registers `claude` only — adding
// Codex/Gemini/Cursor later is one line each.
// See `docs/blueprints/providers/blueprint.md §8`.

import { ValidationError } from '@vynel/errors'
import { ClaudeAiAgentProvider } from './claude/claude-ai-agent-provider.js'
import type { AiAgentProvider } from './shared/ai-agent-provider.js'
import type { AiAgentProviderId } from './shared/ai-agent-provider-id.js'

const aiAgentProvidersByProviderId = new Map<AiAgentProviderId, AiAgentProvider>([
  ['claude', new ClaudeAiAgentProvider()],
  // codex / gemini / cursor land in later phases — one line each.
])

/**
 * Resolves a registered provider by id. Throws `ValidationError` (HTTP 400)
 * when the id is not a registered provider.
 */
export function resolveAiAgentProvider(providerId: AiAgentProviderId): AiAgentProvider {
  const provider = aiAgentProvidersByProviderId.get(providerId)
  if (provider === undefined) {
    const supportedIds = Array.from(aiAgentProvidersByProviderId.keys()).join(', ')
    throw new ValidationError(
      `Unsupported AI agent provider: ${providerId}. Supported providers: ${supportedIds}.`,
    )
  }
  return provider
}

/** Every registered concrete provider instance. */
export function listAvailableAiAgentProviders(): AiAgentProvider[] {
  return Array.from(aiAgentProvidersByProviderId.values())
}

/** The id of every registered provider. */
export function listAvailableAiAgentProviderIds(): AiAgentProviderId[] {
  return Array.from(aiAgentProvidersByProviderId.keys())
}

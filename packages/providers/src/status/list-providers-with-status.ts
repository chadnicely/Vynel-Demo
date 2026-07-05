// Status op: every provider's install + authentication status — pulled from
// the old core `providers` domain (runtime-interrogating reads live with the
// AI seam; preference reads split into `@vynel/provider-preferences`). Phase 1
// yields a single-element array (Claude only); Phase 2 one entry per
// registered provider. Callers holding an injected provider (the API's
// `c.var.aiProvider`) pass it explicitly so tests never interrogate the real
// runtime; the default is the registry — the source op's no-arg shape.

import { listAvailableAiAgentProviders } from '../registry.js'
import type { AiAgentProvider } from '../shared/ai-agent-provider.js'
import type { AuthenticationStatus } from '../shared/authentication-status.js'

export async function listProvidersWithStatus(
  providers: readonly AiAgentProvider[] = listAvailableAiAgentProviders(),
): Promise<AuthenticationStatus[]> {
  return Promise.all(providers.map((provider) => provider.getAuthenticationStatus()))
}

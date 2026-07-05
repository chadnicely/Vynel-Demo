// Status op: the install + authentication status of one AI agent provider.
// The work lives in the provider's own `getAuthenticationStatus`
// (`readClaudeAuthenticationStatus` for Claude). Never throws for normal
// not-installed / not-authenticated states — those are data; throws
// `ValidationError` only for an unregistered provider id.

import { selectAiAgentProvider } from './select-ai-agent-provider.js'
import type { AiAgentProvider } from '../shared/ai-agent-provider.js'
import type { AiAgentProviderId } from '../shared/ai-agent-provider-id.js'
import type { AuthenticationStatus } from '../shared/authentication-status.js'

export async function getProviderAuthenticationStatus(
  providerId: AiAgentProviderId,
  activeProvider?: AiAgentProvider,
): Promise<AuthenticationStatus> {
  return selectAiAgentProvider(providerId, activeProvider).getAuthenticationStatus()
}

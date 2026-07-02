// `AuthenticationStatus` + `AuthenticationMethod` — a provider's install +
// auth state, as data (never an exception). Vynel detects which auth method
// the underlying CLI uses but never extracts the API key value (decisions.md
// D14). See `docs/blueprints/providers/blueprint.md §7.1`.

import type { AiAgentProviderId } from './ai-agent-provider-id.js'

export type AuthenticationMethod = 'oauth' | 'api-key'

export type AuthenticationStatus = {
  providerId: AiAgentProviderId
  isInstalled: boolean
  isAuthenticated: boolean
  /** Email or "Authenticated"/"API Key" — for display. Null when not authenticated. */
  authenticatedAccountLabel: string | null
  authenticationMethod: AuthenticationMethod | null
  /** "Not installed", "OAuth expired", etc. Null when authenticated. */
  inactiveReason: string | null
}

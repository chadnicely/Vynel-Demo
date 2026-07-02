// Type re-exports for `@vynel/provider-preferences` — lets a consumer reach the
// preference-row types + the provider-id union without separately importing
// `@vynel/db` / `@vynel/providers`.

export type {
  ProviderPreference,
  NewProviderPreference,
  ProviderDefaultSettings,
} from '@vynel/db/repositories/providers'
export type { AiAgentProviderId } from '@vynel/providers'

// The user's *effective* default provider — their explicitly-set choice, or
// DEFAULT_PROVIDER_ID ('claude') when they have not chosen one. The non-null
// sibling of `findDefaultProviderForUser` (which returns null on no preference).
//
// Callers that just need "which provider do we run" use this and never handle
// the unset case. It centralizes the "claude is the default" rule here instead
// of scattering a `?? 'claude'` fallback across every consumer — and the swap
// point for a Phase-2 different default is this one line.

import { DEFAULT_PROVIDER_ID } from '@vynel/providers'
import type { AiAgentProviderId } from '@vynel/providers'
import type { Database } from '@vynel/db'
import { findDefaultProviderForUser } from './find-default-provider-for-user.js'

export function getDefaultProviderForUser(db: Database, userId: string): AiAgentProviderId {
  return findDefaultProviderForUser(db, userId) ?? DEFAULT_PROVIDER_ID
}

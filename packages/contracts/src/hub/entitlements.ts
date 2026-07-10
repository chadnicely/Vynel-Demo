// The tier matrix — the ONE home for what each tier unlocks (Chad,
// 2026-07-10: basic gets ONLY channels; pro gets everything). Shared by the
// hub (stamps claims into the entitlement JWT) and the desktop (gates
// sections/routes), so the two sides can't disagree. A value export, like
// the VERIFIED_SKILL_CATALOG precedent. Consumers import the file directly
// (`@vynel/contracts/hub/entitlements`); no barrel.
//
// Core chat + workspaces are deliberately NOT feature keys — they are the
// app's heart, never tier-gated. Voice is its own key (pro for now): the
// vision counts voice as a channel, so moving it into basic is a one-entry
// flip here if Chad decides that.

// One issuer, but DISTINCT `token_use` per JWT kind — both signed with the
// same Ed25519 key, so without this an entitlement token (long-lived, ~7d)
// would satisfy the access verifier and vice versa. Each verifier requires
// its own value; the constants live here so all three sites (hub issuer,
// hub access verifier, desktop entitlement verifier) share one source.
export const HUB_TOKEN_ISSUER = 'vynel-hub'
export const HUB_ACCESS_TOKEN_USE = 'access'
export const HUB_ENTITLEMENT_TOKEN_USE = 'entitlement'

export type HubTier = 'basic' | 'pro'

export type HubFeatureKey =
  | 'channels'
  | 'voice'
  | 'schedules'
  | 'knowledge'
  | 'memory'
  | 'marketplace'

export const ALL_FEATURE_KEYS: readonly HubFeatureKey[] = [
  'channels',
  'voice',
  'schedules',
  'knowledge',
  'memory',
  'marketplace',
]

export const TIER_FEATURES: Readonly<Record<HubTier, readonly HubFeatureKey[]>> = {
  basic: ['channels'],
  pro: ALL_FEATURE_KEYS,
}

/** The entitlement JWT's claims as the desktop reads them after verifying.
 * Identity rides along so an offline boot can show who is signed in from
 * this one stored token. */
export interface HubEntitlementClaims {
  readonly accountId: string
  readonly email: string
  readonly displayName: string
  readonly tier: HubTier
  readonly features: readonly HubFeatureKey[]
  /** Epoch ms — the offline grace boundary (~7 days from issue). */
  readonly expiresAtMs: number
}

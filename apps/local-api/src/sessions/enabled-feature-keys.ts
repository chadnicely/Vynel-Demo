// The ONE home for turning the hub session's entitlement into the composer's
// `enabledFeatureKeys` set. `undefined` = no LIVE entitlement (hub not
// configured, signed out, offline past the grace window) — the composer then
// skips tier filtering entirely, matching the HTTP featureGate's deliberately
// permissive posture (feature-gate.ts). Read PER COMPOSITION, never cached at
// boot: the hub session refreshes its entitlement while the process runs.

import type { HubSession } from '@vynel/hub-account'

export type ReadEnabledFeatureKeys = () => ReadonlySet<string> | undefined

export function resolveEnabledFeatureKeys(
  hubSession: HubSession | undefined,
): ReadonlySet<string> | undefined {
  const entitlement = hubSession?.getEntitlement() ?? null
  if (entitlement === null) return undefined
  return new Set<string>(entitlement.features)
}

/** The closure form for boot-built composers (schedule fires, delegation,
 *  channel turns) — they hold no request context, so they capture the session
 *  once and read the entitlement fresh on every composition. */
export function buildEnabledFeatureKeysReader(
  hubSession: HubSession | undefined,
): ReadEnabledFeatureKeys {
  return () => resolveEnabledFeatureKeys(hubSession)
}

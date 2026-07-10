// Tier enforcement (cloud-api.md §4 + Chad's matrix: basic = channels only).
// Gates a route subtree on a feature key from the VERIFIED entitlement.
// Deliberately permissive when there is NO entitlement to read — hub not
// configured, signed out, or offline past the grace window: locking the app
// to sign-in is a deferred product call (STATE M3 plan §4); the gate only
// enforces what a live entitlement actually says. In-process MCP tool calls
// re-enter through these same routes, so agent and UI see one rulebook.
//
// KNOWN LIMITATION (M3 v1, recorded in STATE): this gates the HTTP surface
// only. A pro→basic downgrade does NOT stop already-scheduled fires or the
// knowledge file watcher (they run via direct package calls in the boot
// services, outside HTTP), and it 403s the whole tree incl. disable/delete.
// Pausing background execution per-entitlement is a deliberate follow-on.

import type { MiddlewareHandler } from 'hono'
import { VynelError } from '@vynel/errors'
import type { HubFeatureKey } from '@vynel/contracts/hub/entitlements'
import type { AppEnv } from '../factory.js'

// Distinct code (not plain `forbidden`): the UI renders an upgrade card for
// this, not an error state.
class FeatureLockedError extends VynelError {
  readonly code = 'feature_locked'
  readonly httpStatus = 403
}

export function featureGate(feature: HubFeatureKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const entitlement = c.var.hubSession?.getEntitlement() ?? null
    if (entitlement !== null && !entitlement.features.includes(feature)) {
      throw new FeatureLockedError(
        `Your plan doesn't include ${feature} — it's part of Vynel Pro.`,
      )
    }
    await next()
  }
}

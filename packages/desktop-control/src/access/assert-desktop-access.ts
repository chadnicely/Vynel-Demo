// The enforcement gate every desktop operation passes through: resolved
// target app + required tier in, silence or `ForbiddenError` out. Fails
// CLOSED — no grant row means no access, and the error tells the model the
// exact recovery path (`request_desktop_access`), so a denial converts into
// a user-consent card instead of a dead end.

import { ForbiddenError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import { findDesktopAppGrant } from '../repositories/desktop-app-grants.js'
import {
  normalizeDesktopAppKey,
  tierAllows,
  type DesktopAccessAuthorizer,
  type DesktopAccessTier,
} from './desktop-access-tiers.js'

export function assertDesktopAccess(
  db: Database,
  input: { userId: string; appName: string; required: DesktopAccessTier },
): void {
  const appKey = normalizeDesktopAppKey(input.appName)
  if (appKey.length === 0) {
    throw new ForbiddenError(
      'Desktop access denied: the target app could not be identified. Name the app explicitly.',
    )
  }
  const grant = findDesktopAppGrant(db, input.userId, appKey)
  if (grant !== null && tierAllows(grant.tier, input.required)) return
  const granted = grant === null ? 'no access granted' : `granted tier: "${grant.tier}"`
  throw new ForbiddenError(
    `Desktop access denied for "${input.appName}": this needs the "${input.required}" tier (${granted}). ` +
      `Call request_desktop_access({ app: "${input.appName}", tier: "${input.required}", reason: <why> }) — ` +
      'the user will see an approval card and can allow it.',
  )
}

/** Bind the gate to a session's db + user — the authorizer the adapters call. */
export function makeDesktopAccessAuthorizer(db: Database, userId: string): DesktopAccessAuthorizer {
  return (resolvedAppName, required) =>
    assertDesktopAccess(db, { userId, appName: resolvedAppName, required })
}

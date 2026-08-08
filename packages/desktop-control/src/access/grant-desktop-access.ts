// Grant / revoke ops for desktop app access — the ONLY writers of
// `desktop_app_grants`. Each op runs in one transaction with its outbox
// event co-committed (architecture invariant §5). Grants only ever move UP:
// an upsert at a lower tier than the existing grant keeps the higher tier
// (a re-request must never silently narrow what the user already approved —
// narrowing is an explicit revoke).

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import {
  findDesktopAppGrant,
  insertDesktopAppGrant,
  updateDesktopAppGrantTier,
  deleteDesktopAppGrant,
  type DesktopAppGrantRow,
} from '../repositories/desktop-app-grants.js'
import {
  maxTier,
  normalizeDesktopAppKey,
  tierAllows,
  type DesktopAccessTier,
} from './desktop-access-tiers.js'
import {
  DESKTOP_ACCESS_GRANTED,
  DESKTOP_ACCESS_REVOKED,
  type DesktopAccessGrantedPayload,
  type DesktopAccessRevokedPayload,
} from '../desktop-control-events.js'

export type GrantDesktopAccessInput = {
  userId: string
  /** Raw app name — normalized here (the one normalization gate for writes). */
  appName: string
  tier: DesktopAccessTier
  now: Date
}

export type GrantDesktopAccessOutcome = {
  grant: DesktopAppGrantRow
  /** `unchanged` when the existing grant already covered the requested tier. */
  outcome: 'created' | 'upgraded' | 'unchanged'
}

export function grantDesktopAccess(
  db: Database,
  input: GrantDesktopAccessInput,
): GrantDesktopAccessOutcome {
  const appKey = normalizeDesktopAppKey(input.appName)
  return withTransaction(db, (tx) => {
    const existing = findDesktopAppGrant(tx, input.userId, appKey)
    if (existing !== null && tierAllows(existing.tier, input.tier)) {
      return { grant: existing, outcome: 'unchanged' }
    }
    if (existing !== null) {
      const upgradedTier = maxTier(existing.tier, input.tier)
      updateDesktopAppGrantTier(tx, { id: existing.id, tier: upgradedTier, now: input.now })
      publishGranted(tx, {
        grantId: existing.id,
        userId: input.userId,
        appName: appKey,
        tier: upgradedTier,
        previousTier: existing.tier,
        grantedAt: input.now.toISOString(),
      })
      return {
        grant: { ...existing, tier: upgradedTier, updatedAt: input.now },
        outcome: 'upgraded',
      }
    }
    const grant = insertDesktopAppGrant(tx, {
      userId: input.userId,
      appName: appKey,
      tier: input.tier,
      now: input.now,
    })
    publishGranted(tx, {
      grantId: grant.id,
      userId: input.userId,
      appName: appKey,
      tier: grant.tier,
      previousTier: null,
      grantedAt: input.now.toISOString(),
    })
    return { grant, outcome: 'created' }
  })
}

export function revokeDesktopAccess(
  db: Database,
  input: { userId: string; appName: string; now: Date },
): DesktopAppGrantRow | null {
  const appKey = normalizeDesktopAppKey(input.appName)
  return withTransaction(db, (tx) => {
    const deleted = deleteDesktopAppGrant(tx, input.userId, appKey)
    if (deleted === null) return null
    const payload: DesktopAccessRevokedPayload = {
      grantId: deleted.id,
      userId: input.userId,
      appName: appKey,
      tier: deleted.tier,
      revokedAt: input.now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: DESKTOP_ACCESS_REVOKED,
      payload,
      createdAt: input.now,
    })
    return deleted
  })
}

function publishGranted(tx: Database, payload: DesktopAccessGrantedPayload): void {
  insertOutboxEvent(tx, {
    id: randomUUID(),
    type: DESKTOP_ACCESS_GRANTED,
    payload,
    createdAt: new Date(payload.grantedAt),
  })
}

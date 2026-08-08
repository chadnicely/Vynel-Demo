// Outbox event type constants + payload interfaces for the `desktop-control`
// domain. Two lifecycle events on the access-grant surface —
// `desktop.access-granted` (create OR tier upgrade) and
// `desktop.access-revoked`. Each event row is co-committed in the same
// transaction as the grant change via the `_shared/outbox` infra.
//
// Consumers (Phase 1: none; future: channels for "Claude was given access to
// X" notifications, audit surfaces) cast the outbox row's payload to the
// typed shape below.

import type { DesktopAccessTier } from './access/desktop-access-tiers.js'

export const DESKTOP_ACCESS_GRANTED = 'desktop.access-granted' as const
export const DESKTOP_ACCESS_REVOKED = 'desktop.access-revoked' as const

export type DesktopAccessGrantedPayload = {
  grantId: string
  userId: string
  /** The normalized grant key (`normalizeDesktopAppKey`). */
  appName: string
  tier: DesktopAccessTier
  /** Null on first grant; the prior tier on an upgrade. */
  previousTier: DesktopAccessTier | null
  grantedAt: string
}

export type DesktopAccessRevokedPayload = {
  grantId: string
  userId: string
  appName: string
  /** The tier the grant held when revoked. */
  tier: DesktopAccessTier
  revokedAt: string
}

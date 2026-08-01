// Wire types for the hub's ADMIN surface (apps/cloud-api /admin/*) — shared by
// the hub's routes and the cloud-admin-web portal. Distinct from
// `./catalog.ts`: browse DTOs are tier-annotated for installers and show only
// published items; the admin view carries the full lifecycle (every status,
// every version) and never annotates `canInstall`.
// Consumers import the file directly (`@vynel/contracts/hub/admin`).

import type {
  HubItemKind,
  HubItemStatus,
  HubCatalogVersion,
  HubPublisherTier,
  HubRecommendedScope,
} from './catalog.js'
import type { HubTier } from './entitlements.js'

export type HubAccountRole = 'member' | 'admin'
export type HubAccountStatus = 'active' | 'disabled'

/** One row of the portal's account-management table. Deliberately NOT the DB
 * row: no passwordHash, no platform internals — the wire shape is the
 * allowlist. */
export interface HubAdminAccount {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly role: HubAccountRole
  readonly tier: HubTier
  /** ISO datetime; null = the tier never lapses. */
  readonly tierExpiresAt: string | null
  readonly status: HubAccountStatus
  readonly createdAt: string
}

export interface HubAdminCatalogItem {
  readonly itemId: string
  readonly kind: HubItemKind
  readonly status: HubItemStatus
  readonly publisherId: string
  readonly publisherName: string
  readonly publisherTier: HubPublisherTier
  readonly displayName: string
  readonly oneLineDescription: string
  readonly category: string
  readonly iconName: string
  readonly recommendedScope: HubRecommendedScope | null
  readonly sourceUrl: string | null
  readonly minimumTier: HubTier
  readonly createdAt: string
  readonly updatedAt: string
  /** Every published version, newest first — the portal's version history. */
  readonly versions: HubCatalogVersion[]
}
